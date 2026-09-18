import { z } from "zod";
import { createHash } from "node:crypto";
import { and, count, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, convocanteQuery, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { aperturas, aperturaRegistros, participaciones, licitaciones } from "@db/schema";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";
import { assertLicitacionExists } from "../lib/domain";
import { assertAperturaTransition } from "../lib/phase2-transitions";
import { writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";

export const aperturasRouter = createRouter({
  list: authedQuery.input(z.object({ licitacionId: z.number().int().positive().optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(aperturas.tenantId, ctx.user.tenantId)];
    if (input?.licitacionId) conditions.push(eq(aperturas.licitacionId, input.licitacionId));
    const where = and(...conditions);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.aperturas.findMany({ where, orderBy: [desc(aperturas.createdAt)], limit: pageSize, offset }),
      db.select({ total: count() }).from(aperturas).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  getByLicitacion: authedQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const item = await getDb().query.aperturas.findFirst({
      where: and(eq(aperturas.tenantId, ctx.user.tenantId), eq(aperturas.licitacionId, input.licitacionId)),
      with: { registros: true },
    });
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Apertura no encontrada." });
    return item;
  }),

  iniciar: convocanteQuery.input(z.object({ licitacionId: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const lic = await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    if (lic.estado !== "PUBLICADA") throw new TRPCError({ code: "CONFLICT", message: "La recepción sólo inicia en PUBLICADA." });
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin expediente." });
    const db = getDb();
    let id = 0;
    await db.transaction(async (tx) => {
      const dup = await tx.query.aperturas.findFirst({ where: and(eq(aperturas.tenantId, ctx.user.tenantId), eq(aperturas.licitacionId, input.licitacionId)) });
      if (dup) throw new TRPCError({ code: "CONFLICT", message: "Ya existe un acto de apertura." });
      const result = await tx.insert(aperturas).values({
        tenantId: ctx.user.tenantId, expedienteId: expediente.id, licitacionId: input.licitacionId,
        estado: "RECEPCION_ABIERTA", creadaPor: ctx.user.id,
      });
      id = Number(result[0].insertId);
      await tx.update(licitaciones).set({ etapa: "PRESENTACION" }).where(and(eq(licitaciones.id, input.licitacionId), eq(licitaciones.tenantId, ctx.user.tenantId)));
      await appendExpedienteEvent(tx, ctx, { expedienteId: expediente.id, tipo: "APERTURA_INICIADA", estadoAnterior: null, estadoNuevo: "RECEPCION_ABIERTA", motivo: input.motivo, payload: { aperturaId: id } });
    });
    const created = await getDb().query.aperturas.findFirst({ where: and(eq(aperturas.id, id), eq(aperturas.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "aperturas", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  cerrarRecepcion: convocanteQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "RECEPCION_CERRADA", input.motivo, { fechaCierreRecepcion: new Date() });
  }),
  sellar: convocanteQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const apertura = await db.query.aperturas.findFirst({ where: and(eq(aperturas.id, input.id), eq(aperturas.tenantId, ctx.user.tenantId)) });
    if (!apertura) throw new TRPCError({ code: "NOT_FOUND", message: "Apertura no encontrada." });
    assertAperturaTransition(apertura.estado as any, "SELLADA");
    const offers = await db.query.participaciones.findMany({ where: and(eq(participaciones.tenantId, ctx.user.tenantId), eq(participaciones.licitacionId, apertura.licitacionId)) });
    const selloHash = createHash("sha256").update(JSON.stringify(offers.map(o => ({ id: o.id, proveedorId: o.proveedorId, monto: o.montoOferta })).sort((a, b) => a.id - b.id))).digest("hex");
    return transition(ctx, input.id, "SELLADA", input.motivo, { fechaSellado: new Date(), selloHash });
  }),
  abrir: convocanteQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "ABIERTA", input.motivo, { fechaApertura: new Date() });
  }),
  registrarOfertas: convocanteQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const apertura = await db.query.aperturas.findFirst({ where: and(eq(aperturas.id, input.id), eq(aperturas.tenantId, ctx.user.tenantId)) });
    if (!apertura) throw new TRPCError({ code: "NOT_FOUND", message: "Apertura no encontrada." });
    assertAperturaTransition(apertura.estado as any, "REGISTRADA");
    const offers = await db.query.participaciones.findMany({ where: and(eq(participaciones.tenantId, ctx.user.tenantId), eq(participaciones.licitacionId, apertura.licitacionId)) });
    await db.transaction(async (tx) => {
      for (const o of offers) {
        await tx.insert(aperturaRegistros).values({
          tenantId: ctx.user.tenantId, aperturaId: apertura.id, participacionId: o.id,
          proveedorId: o.proveedorId, montoOferta: o.montoOferta, presente: true, registradoPor: ctx.user.id,
        });
      }
      const result = await tx.update(aperturas).set({ estado: "REGISTRADA", ofertasRegistradas: offers.length }).where(and(eq(aperturas.id, apertura.id), eq(aperturas.tenantId, ctx.user.tenantId), eq(aperturas.estado, "ABIERTA")));
      if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "La apertura cambió de estado." });
      await appendExpedienteEvent(tx, ctx, { expedienteId: apertura.expedienteId, tipo: "APERTURA_REGISTRADA", estadoAnterior: "ABIERTA", estadoNuevo: "REGISTRADA", motivo: input.motivo, payload: { aperturaId: apertura.id, ofertas: offers.length } });
    });
    const updated = await db.query.aperturas.findFirst({ where: and(eq(aperturas.id, input.id), eq(aperturas.tenantId, ctx.user.tenantId)), with: { registros: true } });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "REGISTRAR", entidad: "aperturas", entidadId: input.id, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),
  emitirActa: convocanteQuery.input(z.object({ id: z.number().int().positive(), actaResumen: z.string().trim().min(10), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "ACTA_EMITIDA", input.motivo, { fechaActa: new Date(), actaResumen: input.actaResumen });
  }),
  publicar: convocanteQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "PUBLICADA", input.motivo, { fechaPublicacion: new Date() });
  }),
});

async function transition(ctx: any, id: number, next: string, motivo: string, patch: Record<string, unknown>) {
  const db = getDb();
  const apertura = await db.query.aperturas.findFirst({ where: and(eq(aperturas.id, id), eq(aperturas.tenantId, ctx.user.tenantId)) });
  if (!apertura) throw new TRPCError({ code: "NOT_FOUND", message: "Apertura no encontrada." });
  assertAperturaTransition(apertura.estado as any, next as any);
  await db.transaction(async (tx) => {
    const result = await tx.update(aperturas).set({ ...patch, estado: next } as any).where(and(eq(aperturas.id, id), eq(aperturas.tenantId, ctx.user.tenantId), eq(aperturas.estado, apertura.estado)));
    if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "La apertura cambió de estado." });
    await appendExpedienteEvent(tx, ctx, { expedienteId: apertura.expedienteId, tipo: `APERTURA_${next}`, estadoAnterior: apertura.estado, estadoNuevo: next, motivo, payload: { aperturaId: id } });
  });
  const updated = await db.query.aperturas.findFirst({ where: and(eq(aperturas.id, id), eq(aperturas.tenantId, ctx.user.tenantId)) });
  await writeAudit({ ctx: ctxForAudit(ctx), accion: "TRANSICION", entidad: "aperturas", entidadId: id, valorAnterior: apertura, valorNuevo: updated, motivo });
  return updated;
}
