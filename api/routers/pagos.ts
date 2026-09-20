import { z } from "zod";
import { and, count, desc, eq, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, procedureMutation, ctxForAudit } from "../middleware";
import { licitacionIdFromContrato, licitacionIdFromEstimacion } from "../lib/procedure-resolvers";
import { getDb } from "../queries/connection";
import { estimacionesPago, contratos } from "@db/schema";
import { assertEstimacionTransition } from "../lib/phase3-transitions";
import { appendExpedienteEvent } from "../lib/expediente";
import { assertNonNegativeDecimal, writeAudit } from "../lib/security";
import { moneyAdd, moneySub, moneyFixed2, moneyGt } from "../lib/money";
import { pageInput, pageResult } from "../lib/pagination";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Importe inválido.");

export const pagosRouter = createRouter({
  list: authedQuery.input(z.object({ contratoId: z.number().int().positive().optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(estimacionesPago.tenantId, ctx.user.tenantId)];
    if (input?.contratoId) conditions.push(eq(estimacionesPago.contratoId, input.contratoId));
    const where = and(...conditions);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.estimacionesPago.findMany({ where, orderBy: [desc(estimacionesPago.createdAt)], limit: pageSize, offset }),
      db.select({ total: count() }).from(estimacionesPago).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  /** Present / create estimation — segregated from review/authorize/pay (aprobar_pago). */
  presentar: procedureMutation({ capability: "presentar_pago", role: "presentar_pago", resolveLicitacionId: (i, ctx) => licitacionIdFromContrato(i, ctx.user!.tenantId) }).input(z.object({
    contratoId: z.number().int().positive(), folio: z.string().trim().min(3).max(80),
    numero: z.number().int().positive(), montoBruto: money, retencion: money.default("0.00"),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    assertNonNegativeDecimal(input.montoBruto, "montoBruto");
    assertNonNegativeDecimal(input.retencion, "retencion");
    const neto = moneyFixed2(moneySub(input.montoBruto, input.retencion));
    if (moneyGt(0, neto)) throw new TRPCError({ code: "BAD_REQUEST", message: "Retención excede bruto." });
    const db = getDb();
    let id = 0;
    await db.transaction(async (tx) => {
      const locked = await tx.select({
        id: contratos.id, estado: contratos.estado, monto: contratos.monto, expedienteId: contratos.expedienteId,
        licitacionId: contratos.licitacionId,
      }).from(contratos)
        .where(and(eq(contratos.id, input.contratoId), eq(contratos.tenantId, ctx.user.tenantId)))
        .for("update")
        .limit(1);
      const contrato = locked[0];
      if (!contrato || !["VIGENTE", "FORMALIZADO"].includes(contrato.estado)) {
        throw new TRPCError({ code: "CONFLICT", message: "Contrato no admite estimaciones." });
      }
      // Cumulative sum of non-rejected estimaciones must not exceed contrato.monto
      const sumRows = await tx.select({
        total: sql<string>`COALESCE(SUM(${estimacionesPago.montoNeto}), 0)`,
      }).from(estimacionesPago).where(and(
        eq(estimacionesPago.tenantId, ctx.user.tenantId),
        eq(estimacionesPago.contratoId, input.contratoId),
        ne(estimacionesPago.estado, "RECHAZADA"),
      ));
      const acumulado = moneyFixed2(sumRows[0]?.total ?? 0);
      const proyectado = moneyFixed2(moneyAdd(acumulado, neto));
      if (moneyGt(proyectado, contrato.monto)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Suma de estimaciones (${proyectado}) excede monto del contrato (${contrato.monto}).`,
        });
      }
      const result = await tx.insert(estimacionesPago).values({
        tenantId: ctx.user.tenantId, contratoId: input.contratoId, folio: input.folio, numero: input.numero,
        montoBruto: input.montoBruto, retencion: input.retencion, montoNeto: neto, estado: "PRESENTADA", presentadaPor: ctx.user.id,
      });
      id = Number(result[0].insertId);
      await appendExpedienteEvent(tx, ctx, { expedienteId: contrato.expedienteId, tipo: "ESTIMACION_PRESENTADA", estadoAnterior: null, estadoNuevo: "PRESENTADA", motivo: input.motivo, payload: { estimacionId: id, montoNeto: neto } });
    });
    const created = await db.query.estimacionesPago.findFirst({ where: and(eq(estimacionesPago.id, id), eq(estimacionesPago.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "estimaciones_pago", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  revisar: procedureMutation({ capability: "aprobar_pago", role: "aprobar_pago", resolveLicitacionId: (i, ctx) => licitacionIdFromEstimacion(i, ctx.user!.tenantId) }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "EN_REVISION", input.motivo, { revisadaPor: ctx.user.id });
  }),
  autorizar: procedureMutation({ capability: "aprobar_pago", role: "aprobar_pago", resolveLicitacionId: (i, ctx) => licitacionIdFromEstimacion(i, ctx.user!.tenantId) }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "AUTORIZADA", input.motivo, { autorizadaPor: ctx.user.id });
  }),
  pagar: procedureMutation({ capability: "aprobar_pago", role: "aprobar_pago", resolveLicitacionId: (i, ctx) => licitacionIdFromEstimacion(i, ctx.user!.tenantId) }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "PAGADA", input.motivo, { pagadaAt: new Date() });
  }),
  rechazar: procedureMutation({ capability: "aprobar_pago", role: "aprobar_pago", resolveLicitacionId: (i, ctx) => licitacionIdFromEstimacion(i, ctx.user!.tenantId) }).input(z.object({ id: z.number().int().positive(), motivoRechazo: z.string().trim().min(5), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "RECHAZADA", input.motivo, { motivoRechazo: input.motivoRechazo });
  }),
});

async function transition(ctx: any, id: number, next: string, motivo: string, patch: Record<string, unknown>) {
  const db = getDb();
  const current = await db.query.estimacionesPago.findFirst({ where: and(eq(estimacionesPago.id, id), eq(estimacionesPago.tenantId, ctx.user.tenantId)) });
  if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Estimación no encontrada." });
  assertEstimacionTransition(current.estado as any, next as any);
  const contrato = await db.query.contratos.findFirst({ where: and(eq(contratos.id, current.contratoId), eq(contratos.tenantId, ctx.user.tenantId)) });
  if (!contrato) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
  if (["EN_REVISION", "AUTORIZADA", "PAGADA", "RECHAZADA"].includes(next)) {
  }
  await db.transaction(async (tx) => {
    const result = await tx.update(estimacionesPago).set({ ...patch, estado: next } as any).where(and(eq(estimacionesPago.id, id), eq(estimacionesPago.tenantId, ctx.user.tenantId), eq(estimacionesPago.estado, current.estado)));
    if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "La estimación cambió de estado." });
    await appendExpedienteEvent(tx, ctx, { expedienteId: contrato.expedienteId, tipo: `ESTIMACION_${next}`, estadoAnterior: current.estado, estadoNuevo: next, motivo, payload: { estimacionId: id } });
  });
  const updated = await db.query.estimacionesPago.findFirst({ where: and(eq(estimacionesPago.id, id), eq(estimacionesPago.tenantId, ctx.user.tenantId)) });
  await writeAudit({ ctx: ctxForAudit(ctx), accion: "TRANSICION", entidad: "estimaciones_pago", entidadId: id, valorAnterior: current, valorNuevo: updated, motivo });
  return updated;
}
