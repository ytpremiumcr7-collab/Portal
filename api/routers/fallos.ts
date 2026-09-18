import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, convocanteQuery, adminQuery, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { fallos, dictamenes, licitaciones, participaciones } from "@db/schema";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";
import { assertLicitacionExists } from "../lib/domain";
import { assertFalloTransition, assertFalloRequiresDictamen } from "../lib/phase2-transitions";
import { assertNonNegativeDecimal, writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";
import { assertProcedimientoAsignacion } from "../lib/sod";
import { assertEvaluacionesCompletas } from "../lib/eval-completeness";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Importe inválido.");

export const fallosRouter = createRouter({
  list: authedQuery.input(z.object({ licitacionId: z.number().int().positive().optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(fallos.tenantId, ctx.user.tenantId)];
    if (input?.licitacionId) conditions.push(eq(fallos.licitacionId, input.licitacionId));
    const where = and(...conditions);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.fallos.findMany({ where, orderBy: [desc(fallos.createdAt)], limit: pageSize, offset }),
      db.select({ total: count() }).from(fallos).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  getByLicitacion: authedQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const item = await getDb().query.fallos.findFirst({ where: and(eq(fallos.tenantId, ctx.user.tenantId), eq(fallos.licitacionId, input.licitacionId)) });
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Fallo no encontrado." });
    return item;
  }),

  emitirBorrador: convocanteQuery.input(z.object({
    licitacionId: z.number().int().positive(),
    dictamenId: z.number().int().positive(),
    sentido: z.enum(["ADJUDICAR", "DESIERTO", "CANCELAR"]),
    proveedorGanadorId: z.number().int().positive().optional(),
    montoAdjudicado: money.optional(),
    fundamento: z.string().trim().min(20),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const lic = await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    if (lic.estado !== "EN_EVALUACION") throw new TRPCError({ code: "CONFLICT", message: "El fallo se emite con la licitación EN_EVALUACION." });
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin expediente." });
    const db = getDb();
    const dictamen = await db.query.dictamenes.findFirst({ where: and(eq(dictamenes.id, input.dictamenId), eq(dictamenes.tenantId, ctx.user.tenantId), eq(dictamenes.licitacionId, input.licitacionId)) });
    assertFalloRequiresDictamen(dictamen as any, input.sentido, input.proveedorGanadorId, input.montoAdjudicado);
    if (input.sentido === "ADJUDICAR") {
      if (!input.proveedorGanadorId || !input.montoAdjudicado) throw new TRPCError({ code: "BAD_REQUEST", message: "ADJUDICAR requiere proveedor y monto." });
      assertNonNegativeDecimal(input.montoAdjudicado, "montoAdjudicado");
    }
    let id = 0;
    await db.transaction(async (tx) => {
      const dup = await tx.query.fallos.findFirst({ where: and(eq(fallos.tenantId, ctx.user.tenantId), eq(fallos.licitacionId, input.licitacionId)) });
      if (dup) throw new TRPCError({ code: "CONFLICT", message: "Ya existe un fallo para esta licitación." });
      const result = await tx.insert(fallos).values({
        tenantId: ctx.user.tenantId, expedienteId: expediente.id, licitacionId: input.licitacionId,
        dictamenId: input.dictamenId, estado: "BORRADOR", sentido: input.sentido,
        proveedorGanadorId: input.proveedorGanadorId ?? null, montoAdjudicado: input.montoAdjudicado ?? null,
        fundamento: input.fundamento,
      });
      id = Number(result[0].insertId);
      await tx.update(licitaciones).set({ etapa: "FALLO" }).where(and(eq(licitaciones.id, input.licitacionId), eq(licitaciones.tenantId, ctx.user.tenantId)));
      await appendExpedienteEvent(tx, ctx, { expedienteId: expediente.id, tipo: "FALLO_BORRADOR", estadoAnterior: null, estadoNuevo: "BORRADOR", motivo: input.motivo, payload: { falloId: id, sentido: input.sentido } });
    });
    const created = await getDb().query.fallos.findFirst({ where: and(eq(fallos.id, id), eq(fallos.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "fallos", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  emitir: convocanteQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "EMITIDO", input.motivo, { emitidoPor: ctx.user.id, emitidoAt: new Date() });
  }),
  aprobar: adminQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "APROBADO", input.motivo, { aprobadoPor: ctx.user.id, aprobadoAt: new Date() });
  }),
  publicar: adminQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "PUBLICADO", input.motivo, { publicadoAt: new Date() });
  }),
});

async function transition(ctx: any, id: number, next: string, motivo: string, patch: Record<string, unknown>) {
  const db = getDb();
  const current = await db.query.fallos.findFirst({ where: and(eq(fallos.id, id), eq(fallos.tenantId, ctx.user.tenantId)) });
  if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Fallo no encontrado." });
  assertFalloTransition(current.estado as any, next as any);
  if (next === "APROBADO" || next === "PUBLICADO") {
    await assertProcedimientoAsignacion(ctx.user, current.licitacionId, "autorizador_fallo");
  }
  if (next === "PUBLICADO") {
    const offers = await db.select({ id: participaciones.id, estadoEvaluacion: participaciones.estadoEvaluacion })
      .from(participaciones)
      .where(and(eq(participaciones.tenantId, ctx.user.tenantId), eq(participaciones.licitacionId, current.licitacionId)));
    assertEvaluacionesCompletas(offers);
  }
  await db.transaction(async (tx) => {
    const result = await tx.update(fallos).set({ ...patch, estado: next } as any).where(and(eq(fallos.id, id), eq(fallos.tenantId, ctx.user.tenantId), eq(fallos.estado, current.estado)));
    if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "El fallo cambió de estado." });
    await appendExpedienteEvent(tx, ctx, { expedienteId: current.expedienteId, tipo: `FALLO_${next}`, estadoAnterior: current.estado, estadoNuevo: next, motivo, payload: { falloId: id } });
  });
  const updated = await db.query.fallos.findFirst({ where: and(eq(fallos.id, id), eq(fallos.tenantId, ctx.user.tenantId)) });
  await writeAudit({ ctx: ctxForAudit(ctx), accion: "TRANSICION", entidad: "fallos", entidadId: id, valorAnterior: current, valorNuevo: updated, motivo });
  return updated;
}
