import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, convocanteQuery, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { contratos, fallos, licitaciones } from "@db/schema";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";
import { assertLicitacionExists } from "../lib/domain";
import { assertContratoTransition, assertContratoRequiresAdjudicacion } from "../lib/phase2-transitions";
import { assertNonNegativeDecimal, writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Importe inválido.");
const dateMx = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");

export const contratosRouter = createRouter({
  list: authedQuery.input(z.object({ licitacionId: z.number().int().positive().optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(contratos.tenantId, ctx.user.tenantId)];
    if (input?.licitacionId) conditions.push(eq(contratos.licitacionId, input.licitacionId));
    const where = and(...conditions);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.contratos.findMany({ where, orderBy: [desc(contratos.createdAt)], limit: pageSize, offset }),
      db.select({ total: count() }).from(contratos).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  getById: authedQuery.input(z.object({ id: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const item = await getDb().query.contratos.findFirst({ where: and(eq(contratos.id, input.id), eq(contratos.tenantId, ctx.user.tenantId)), with: { garantias: true } });
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
    return item;
  }),

  crear: convocanteQuery.input(z.object({
    licitacionId: z.number().int().positive(),
    folio: z.string().trim().min(3).max(80),
    objeto: z.string().trim().min(10).optional(),
    fechaInicio: dateMx.optional(),
    fechaFin: dateMx.optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const lic = await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    const db = getDb();
    const fallo = await db.query.fallos.findFirst({ where: and(eq(fallos.tenantId, ctx.user.tenantId), eq(fallos.licitacionId, input.licitacionId)) });
    assertContratoRequiresAdjudicacion(lic.estado, fallo?.estado);
    if (!fallo || fallo.sentido !== "ADJUDICAR" || !fallo.proveedorGanadorId || !fallo.montoAdjudicado) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El fallo publicado debe adjudicar con proveedor y monto." });
    }
    if (Number(lic.proveedorGanadorId) !== Number(fallo.proveedorGanadorId)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Inconsistencia entre adjudicación y fallo." });
    }
    assertNonNegativeDecimal(String(fallo.montoAdjudicado), "monto");
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin expediente." });
    let id = 0;
    await db.transaction(async (tx) => {
      const dup = await tx.query.contratos.findFirst({ where: and(eq(contratos.tenantId, ctx.user.tenantId), eq(contratos.licitacionId, input.licitacionId)) });
      if (dup) throw new TRPCError({ code: "CONFLICT", message: "Ya existe un contrato para esta licitación." });
      const proveedorId = Number(fallo.proveedorGanadorId);
      const monto = String(fallo.montoAdjudicado);
      const result = await tx.insert(contratos).values({
        tenantId: ctx.user.tenantId, expedienteId: expediente.id, licitacionId: input.licitacionId,
        falloId: fallo.id, proveedorId, folio: input.folio,
        estado: "BORRADOR", monto, moneda: "MXN",
        objeto: input.objeto ?? lic.objeto, fechaInicio: input.fechaInicio ?? null, fechaFin: input.fechaFin ?? null,
      } as typeof contratos.$inferInsert);
      id = Number(result[0].insertId);
      await tx.update(licitaciones).set({ etapa: "CONTRATACION" }).where(and(eq(licitaciones.id, input.licitacionId), eq(licitaciones.tenantId, ctx.user.tenantId)));
      await appendExpedienteEvent(tx, ctx, { expedienteId: expediente.id, tipo: "CONTRATO_CREADO", estadoAnterior: null, estadoNuevo: "BORRADOR", motivo: input.motivo, payload: { contratoId: id, folio: input.folio } });
    });
    const created = await getDb().query.contratos.findFirst({ where: and(eq(contratos.id, id), eq(contratos.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "contratos", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  formalizar: convocanteQuery.input(z.object({ id: z.number().int().positive(), fechaFirma: dateMx, motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "FORMALIZADO", input.motivo, { fechaFirma: input.fechaFirma, formalizadoPor: ctx.user.id });
  }),
  ponerVigente: convocanteQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "VIGENTE", input.motivo, {});
  }),
  terminar: convocanteQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "TERMINADO", input.motivo, {});
  }),
  rescindir: convocanteQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "RESCINDIDO", input.motivo, {});
  }),
});

async function transition(ctx: any, id: number, next: string, motivo: string, patch: Record<string, unknown>) {
  const db = getDb();
  const current = await db.query.contratos.findFirst({ where: and(eq(contratos.id, id), eq(contratos.tenantId, ctx.user.tenantId)) });
  if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
  assertContratoTransition(current.estado as any, next as any);
  await db.transaction(async (tx) => {
    const result = await tx.update(contratos).set({ ...patch, estado: next } as any).where(and(eq(contratos.id, id), eq(contratos.tenantId, ctx.user.tenantId), eq(contratos.estado, current.estado)));
    if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "El contrato cambió de estado." });
    await appendExpedienteEvent(tx, ctx, { expedienteId: current.expedienteId, tipo: `CONTRATO_${next}`, estadoAnterior: current.estado, estadoNuevo: next, motivo, payload: { contratoId: id } });
  });
  const updated = await db.query.contratos.findFirst({ where: and(eq(contratos.id, id), eq(contratos.tenantId, ctx.user.tenantId)) });
  await writeAudit({ ctx: ctxForAudit(ctx), accion: "TRANSICION", entidad: "contratos", entidadId: id, valorAnterior: current, valorNuevo: updated, motivo });
  return updated;
}
