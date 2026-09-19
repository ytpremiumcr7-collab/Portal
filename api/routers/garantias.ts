import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, convocanteQuery, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { garantias, contratos, documentos, proveedores } from "@db/schema";
import { appendExpedienteEvent } from "../lib/expediente";
import { assertGarantiaTransition } from "../lib/phase2-transitions";
import { assertGarantiaListaParaVigente } from "../lib/garantia-gates";
import { assertNonNegativeDecimal, writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";
import { assertDocumentoBoundToContext } from "../lib/documento-binding";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Importe inválido.");
const dateMx = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");

async function ensureProviderForUser(tenantId: number, userId: number) {
  const provider = await getDb().query.proveedores.findFirst({
    where: and(eq(proveedores.tenantId, tenantId), eq(proveedores.usuarioId, userId), eq(proveedores.activo, true)),
  });
  if (!provider) throw new TRPCError({ code: "FORBIDDEN", message: "Sin expediente de proveedor activo." });
  return provider;
}

export const garantiasRouter = createRouter({
  list: authedQuery.input(z.object({ contratoId: z.number().int().positive().optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(garantias.tenantId, ctx.user.tenantId)];
    if (input?.contratoId) conditions.push(eq(garantias.contratoId, input.contratoId));
    const where = and(...conditions);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.garantias.findMany({ where, orderBy: [desc(garantias.createdAt)], limit: pageSize, offset }),
      db.select({ total: count() }).from(garantias).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  /** Convocante requires a garantía (receive side configures expectation). */
  requerir: convocanteQuery.input(z.object({
    contratoId: z.number().int().positive(),
    tipo: z.enum(["CUMPLIMIENTO", "ANTICIPO", "VICIOS_OCULTOS", "SERIEDAD"]),
    monto: money,
    porcentaje: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    assertNonNegativeDecimal(input.monto, "monto");
    const db = getDb();
    const contrato = await db.query.contratos.findFirst({ where: and(eq(contratos.id, input.contratoId), eq(contratos.tenantId, ctx.user.tenantId)) });
    if (!contrato) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
    if (!["BORRADOR", "FORMALIZADO", "VIGENTE"].includes(contrato.estado)) throw new TRPCError({ code: "CONFLICT", message: "El contrato no admite nuevas garantías." });
    let id = 0;
    await db.transaction(async (tx) => {
      const result = await tx.insert(garantias).values({
        tenantId: ctx.user.tenantId, contratoId: contrato.id, licitacionId: contrato.licitacionId,
        proveedorId: contrato.proveedorId, tipo: input.tipo, estado: "REQUERIDA", monto: input.monto, porcentaje: input.porcentaje ?? null, moneda: "MXN",
      });
      id = Number(result[0].insertId);
      await appendExpedienteEvent(tx, ctx, { expedienteId: contrato.expedienteId, tipo: "GARANTIA_REQUERIDA", estadoAnterior: null, estadoNuevo: "REQUERIDA", motivo: input.motivo, payload: { garantiaId: id, tipo: input.tipo, monto: input.monto } });
    });
    const created = await getDb().query.garantias.findFirst({ where: and(eq(garantias.id, id), eq(garantias.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "garantias", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  /**
   * Present / receive garantía — proveedor (own) OR convocante (documented intake).
   * Does NOT activate; activate is convocante-only.
   */
  presentar: authedQuery.input(z.object({
    id: z.number().int().positive(),
    instrumento: z.string().trim().min(2).max(120),
    numeroPoliza: z.string().trim().min(2).max(80),
    fechaInicio: dateMx,
    fechaVencimiento: dateMx,
    documentoId: z.number().int().positive(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const current = await db.query.garantias.findFirst({ where: and(eq(garantias.id, input.id), eq(garantias.tenantId, ctx.user.tenantId)) });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Garantía no encontrada." });
    if (ctx.user.role === "proveedor") {
      const provider = await ensureProviderForUser(ctx.user.tenantId, ctx.user.id);
      if (Number(current.proveedorId) !== Number(provider.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sólo el proveedor titular puede presentar esta garantía." });
      }
    } else if (!["admin", "licitante"].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Sin permiso para intake de garantía." });
    }
    const contrato = await db.query.contratos.findFirst({ where: and(eq(contratos.id, current.contratoId), eq(contratos.tenantId, ctx.user.tenantId)) });
    if (!contrato) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato de la garantía no encontrado." });
    const doc = await db.query.documentos.findFirst({
      where: and(eq(documentos.id, input.documentoId), eq(documentos.tenantId, ctx.user.tenantId), eq(documentos.esVersionVigente, true)),
    });
    assertDocumentoBoundToContext(doc, {
      tenantId: ctx.user.tenantId,
      expedienteId: contrato.expedienteId,
      licitacionId: current.licitacionId,
      proveedorId: current.proveedorId,
      expectedTipo: "GARANTIA",
    });
    return transition(ctx, input.id, "PRESENTADA", input.motivo, {
      instrumento: input.instrumento, numeroPoliza: input.numeroPoliza,
      fechaInicio: input.fechaInicio, fechaVencimiento: input.fechaVencimiento,
      documentoId: input.documentoId, presentadaAt: new Date(),
    });
  }),

  /** Validate / activar — convocante capability only; requires complete fields + documento. */
  activar: convocanteQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const current = await db.query.garantias.findFirst({ where: and(eq(garantias.id, input.id), eq(garantias.tenantId, ctx.user.tenantId)) });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Garantía no encontrada." });
    assertGarantiaListaParaVigente({
      tipo: current.tipo, monto: current.monto, instrumento: current.instrumento,
      numeroPoliza: current.numeroPoliza, fechaInicio: current.fechaInicio as any,
      fechaVencimiento: current.fechaVencimiento as any, documentoId: (current as any).documentoId,
    });
    const contrato = await db.query.contratos.findFirst({ where: and(eq(contratos.id, current.contratoId), eq(contratos.tenantId, ctx.user.tenantId)) });
    if (!contrato) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato de la garantía no encontrado." });
    if (current.documentoId) {
      const doc = await db.query.documentos.findFirst({
        where: and(eq(documentos.id, current.documentoId), eq(documentos.tenantId, ctx.user.tenantId)),
      });
      assertDocumentoBoundToContext(doc, {
        tenantId: ctx.user.tenantId,
        expedienteId: contrato.expedienteId,
        licitacionId: current.licitacionId,
        proveedorId: current.proveedorId,
        expectedTipo: "GARANTIA",
      });
    }
    return transition(ctx, input.id, "VIGENTE", input.motivo, {});
  }),

  liberar: convocanteQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "LIBERADA", input.motivo, { liberadaAt: new Date() });
  }),
  ejecutar: convocanteQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "EJECUTADA", input.motivo, {});
  }),
});

async function transition(ctx: any, id: number, next: string, motivo: string, patch: Record<string, unknown>) {
  const db = getDb();
  const current = await db.query.garantias.findFirst({ where: and(eq(garantias.id, id), eq(garantias.tenantId, ctx.user.tenantId)) });
  if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Garantía no encontrada." });
  assertGarantiaTransition(current.estado as any, next as any);
  const contrato = await db.query.contratos.findFirst({ where: and(eq(contratos.id, current.contratoId), eq(contratos.tenantId, ctx.user.tenantId)) });
  if (!contrato) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato de la garantía no encontrado." });
  await db.transaction(async (tx) => {
    const result = await tx.update(garantias).set({ ...patch, estado: next } as any).where(and(eq(garantias.id, id), eq(garantias.tenantId, ctx.user.tenantId), eq(garantias.estado, current.estado)));
    if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "La garantía cambió de estado." });
    await appendExpedienteEvent(tx, ctx, { expedienteId: contrato.expedienteId, tipo: `GARANTIA_${next}`, estadoAnterior: current.estado, estadoNuevo: next, motivo, payload: { garantiaId: id } });
  });
  const updated = await db.query.garantias.findFirst({ where: and(eq(garantias.id, id), eq(garantias.tenantId, ctx.user.tenantId)) });
  await writeAudit({ ctx: ctxForAudit(ctx), accion: "TRANSICION", entidad: "garantias", entidadId: id, valorAnterior: current, valorNuevo: updated, motivo });
  return updated;
}
