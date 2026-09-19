import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, procedureMutation, authedQuery, ctxForAudit } from "../middleware";
import { licitacionIdFromInput, licitacionIdFromDictamen } from "../lib/procedure-resolvers";
import { getDb } from "../queries/connection";
import { dictamenes, dictamenFirmantes, participaciones, licitaciones } from "@db/schema";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";
import { assertLicitacionExists } from "../lib/domain";
import { assertDictamenTransition } from "../lib/phase2-transitions";
import { assertNonNegativeDecimal, writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";
import { assertEvaluacionesCompletas } from "../lib/eval-completeness";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Importe inválido.");

export const dictamenesRouter = createRouter({
  list: authedQuery.input(z.object({ licitacionId: z.number().int().positive().optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(dictamenes.tenantId, ctx.user.tenantId)];
    if (input?.licitacionId) conditions.push(eq(dictamenes.licitacionId, input.licitacionId));
    const where = and(...conditions);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.dictamenes.findMany({ where, orderBy: [desc(dictamenes.version)], limit: pageSize, offset, with: { firmantes: true } }),
      db.select({ total: count() }).from(dictamenes).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  getById: authedQuery.input(z.object({ id: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const item = await getDb().query.dictamenes.findFirst({
      where: and(eq(dictamenes.id, input.id), eq(dictamenes.tenantId, ctx.user.tenantId)),
      with: { firmantes: true },
    });
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Dictamen no encontrado." });
    return item;
  }),

  crear: procedureMutation({ capability: "emitir_dictamen", role: "dictaminador", resolveLicitacionId: (i, ctx) => (i as any).licitacionId ? licitacionIdFromInput(i) : licitacionIdFromDictamen(i, ctx.user!.tenantId) }).input(z.object({
    licitacionId: z.number().int().positive(),
    fundamento: z.string().trim().min(20),
    resultado: z.enum(["RECOMENDAR_ADJUDICACION", "DECLARAR_DESIERTO", "RECOMENDAR_CANCELACION"]),
    proveedorRecomendadoId: z.number().int().positive().optional(),
    montoRecomendado: money.optional(),
    firmantes: z.array(z.object({ usuarioId: z.number().int().positive(), rolFirma: z.string().trim().min(2).max(80) })).min(1),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const lic = await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    if (lic.estado !== "EN_EVALUACION") throw new TRPCError({ code: "CONFLICT", message: "El dictamen se elabora en EN_EVALUACION." });
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin expediente." });
    if (input.resultado === "RECOMENDAR_ADJUDICACION") {
      if (!input.proveedorRecomendadoId || !input.montoRecomendado) throw new TRPCError({ code: "BAD_REQUEST", message: "Adjudicación requiere proveedor y monto recomendados." });
      assertNonNegativeDecimal(input.montoRecomendado, "montoRecomendado");
      const offer = await getDb().query.participaciones.findFirst({
        where: and(eq(participaciones.tenantId, ctx.user.tenantId), eq(participaciones.licitacionId, input.licitacionId), eq(participaciones.proveedorId, input.proveedorRecomendadoId), eq(participaciones.estadoEvaluacion, "ADMISIBLE")),
      });
      if (!offer || offer.ordenMerito !== 1) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El proveedor recomendado debe ser el 1er lugar admisible." });
      if (Number(input.montoRecomendado) !== Number(offer.montoOferta)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El monto recomendado debe coincidir con la oferta." });
    }
    const db = getDb();
    let id = 0;
    await db.transaction(async (tx) => {
      const versions = await tx.select({ total: count() }).from(dictamenes).where(and(eq(dictamenes.tenantId, ctx.user.tenantId), eq(dictamenes.licitacionId, input.licitacionId)));
      const version = Number(versions[0]?.total ?? 0) + 1;
      const active = await tx.query.dictamenes.findFirst({ where: and(eq(dictamenes.tenantId, ctx.user.tenantId), eq(dictamenes.licitacionId, input.licitacionId), eq(dictamenes.estado, "APROBADO")) });
      if (active) throw new TRPCError({ code: "CONFLICT", message: "Ya existe un dictamen APROBADO; no cree otro sin rechazarlo formalmente vía nueva versión tras rechazo." });
      const pending = await tx.query.dictamenes.findFirst({ where: and(eq(dictamenes.tenantId, ctx.user.tenantId), eq(dictamenes.licitacionId, input.licitacionId), eq(dictamenes.estado, "EMITIDO")) });
      if (pending) throw new TRPCError({ code: "CONFLICT", message: "Hay un dictamen EMITIDO pendiente de aprobación." });
      const result = await tx.insert(dictamenes).values({
        tenantId: ctx.user.tenantId, expedienteId: expediente.id, licitacionId: input.licitacionId, version,
        estado: "BORRADOR", resultado: input.resultado,
        proveedorRecomendadoId: input.proveedorRecomendadoId ?? null,
        montoRecomendado: input.montoRecomendado ?? null,
        fundamento: input.fundamento,
      });
      id = Number(result[0].insertId);
      for (const f of input.firmantes) {
        await tx.insert(dictamenFirmantes).values({ tenantId: ctx.user.tenantId, dictamenId: id, usuarioId: f.usuarioId, rolFirma: f.rolFirma, firmado: false });
      }
      await tx.update(licitaciones).set({ etapa: "DICTAMEN" }).where(and(eq(licitaciones.id, input.licitacionId), eq(licitaciones.tenantId, ctx.user.tenantId)));
      await appendExpedienteEvent(tx, ctx, { expedienteId: expediente.id, tipo: "DICTAMEN_CREADO", estadoAnterior: null, estadoNuevo: "BORRADOR", motivo: input.motivo, payload: { dictamenId: id, version, resultado: input.resultado } });
    });
    const created = await getDb().query.dictamenes.findFirst({ where: and(eq(dictamenes.id, id), eq(dictamenes.tenantId, ctx.user.tenantId)), with: { firmantes: true } });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "dictamenes", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  firmar: procedureMutation({ capability: "emitir_dictamen", role: "dictaminador", resolveLicitacionId: (i, ctx) => (i as any).licitacionId ? licitacionIdFromInput(i) : licitacionIdFromDictamen(i, ctx.user!.tenantId) }).input(z.object({ dictamenId: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const firmante = await db.query.dictamenFirmantes.findFirst({
      where: and(eq(dictamenFirmantes.tenantId, ctx.user.tenantId), eq(dictamenFirmantes.dictamenId, input.dictamenId), eq(dictamenFirmantes.usuarioId, ctx.user.id)),
    });
    if (!firmante) throw new TRPCError({ code: "FORBIDDEN", message: "No está designado como firmante de este dictamen." });
    if (firmante.firmado) throw new TRPCError({ code: "CONFLICT", message: "Ya firmó este dictamen." });
    const dictamen = await db.query.dictamenes.findFirst({ where: and(eq(dictamenes.id, input.dictamenId), eq(dictamenes.tenantId, ctx.user.tenantId)) });
    if (!dictamen || dictamen.estado !== "BORRADOR") throw new TRPCError({ code: "CONFLICT", message: "Sólo se firma en BORRADOR." });
    await db.transaction(async (tx) => {
      await tx.update(dictamenFirmantes).set({ firmado: true, firmadoAt: new Date() }).where(and(eq(dictamenFirmantes.id, firmante.id), eq(dictamenFirmantes.tenantId, ctx.user.tenantId)));
      await appendExpedienteEvent(tx, ctx, { expedienteId: dictamen.expedienteId, tipo: "DICTAMEN_FIRMA", estadoAnterior: "BORRADOR", estadoNuevo: "BORRADOR", motivo: input.motivo, payload: { dictamenId: dictamen.id, usuarioId: ctx.user.id } });
    });
    return getDb().query.dictamenes.findFirst({ where: and(eq(dictamenes.id, input.dictamenId), eq(dictamenes.tenantId, ctx.user.tenantId)), with: { firmantes: true } });
  }),

  emitir: procedureMutation({ capability: "emitir_dictamen", role: "dictaminador", resolveLicitacionId: (i, ctx) => (i as any).licitacionId ? licitacionIdFromInput(i) : licitacionIdFromDictamen(i, ctx.user!.tenantId) }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const current = await db.query.dictamenes.findFirst({ where: and(eq(dictamenes.id, input.id), eq(dictamenes.tenantId, ctx.user.tenantId)), with: { firmantes: true } });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Dictamen no encontrado." });
    assertDictamenTransition(current.estado as any, "EMITIDO");
    if (!current.firmantes.length || current.firmantes.some((f: any) => !f.firmado)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Todos los firmantes deben haber firmado antes de emitir." });
    }
    const offers = await db.select({ id: participaciones.id, estadoEvaluacion: participaciones.estadoEvaluacion })
      .from(participaciones)
      .where(and(eq(participaciones.tenantId, ctx.user.tenantId), eq(participaciones.licitacionId, current.licitacionId)));
    assertEvaluacionesCompletas(offers);
    await db.transaction(async (tx) => {
      const result = await tx.update(dictamenes).set({ estado: "EMITIDO", emitidoPor: ctx.user.id, emitidoAt: new Date() }).where(and(eq(dictamenes.id, input.id), eq(dictamenes.tenantId, ctx.user.tenantId), eq(dictamenes.estado, "BORRADOR")));
      if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "El dictamen cambió de estado." });
      await appendExpedienteEvent(tx, ctx, { expedienteId: current.expedienteId, tipo: "DICTAMEN_EMITIDO", estadoAnterior: "BORRADOR", estadoNuevo: "EMITIDO", motivo: input.motivo, payload: { dictamenId: current.id } });
    });
    const updated = await db.query.dictamenes.findFirst({ where: and(eq(dictamenes.id, input.id), eq(dictamenes.tenantId, ctx.user.tenantId)), with: { firmantes: true } });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "EMITIR", entidad: "dictamenes", entidadId: input.id, valorAnterior: current, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),

  aprobar: procedureMutation({ capability: "emitir_dictamen", role: "dictaminador", resolveLicitacionId: (i, ctx) => licitacionIdFromDictamen(i, ctx.user!.tenantId) }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const current = await db.query.dictamenes.findFirst({ where: and(eq(dictamenes.id, input.id), eq(dictamenes.tenantId, ctx.user.tenantId)) });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Dictamen no encontrado." });
    assertDictamenTransition(current.estado as any, "APROBADO");
    await db.transaction(async (tx) => {
      const result = await tx.update(dictamenes).set({ estado: "APROBADO", aprobadoPor: ctx.user.id, aprobadoAt: new Date() }).where(and(eq(dictamenes.id, input.id), eq(dictamenes.tenantId, ctx.user.tenantId), eq(dictamenes.estado, "EMITIDO")));
      if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "El dictamen cambió de estado." });
      await appendExpedienteEvent(tx, ctx, { expedienteId: current.expedienteId, tipo: "DICTAMEN_APROBADO", estadoAnterior: "EMITIDO", estadoNuevo: "APROBADO", motivo: input.motivo, payload: { dictamenId: current.id } });
    });
    const updated = await db.query.dictamenes.findFirst({ where: and(eq(dictamenes.id, input.id), eq(dictamenes.tenantId, ctx.user.tenantId)), with: { firmantes: true } });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "APROBAR", entidad: "dictamenes", entidadId: input.id, valorAnterior: current, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),

  rechazar: procedureMutation({ capability: "emitir_dictamen", role: "dictaminador", resolveLicitacionId: (i, ctx) => licitacionIdFromDictamen(i, ctx.user!.tenantId) }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const current = await db.query.dictamenes.findFirst({ where: and(eq(dictamenes.id, input.id), eq(dictamenes.tenantId, ctx.user.tenantId)) });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Dictamen no encontrado." });
    assertDictamenTransition(current.estado as any, "RECHAZADO");
    await db.transaction(async (tx) => {
      const result = await tx.update(dictamenes).set({ estado: "RECHAZADO", aprobadoPor: ctx.user.id, aprobadoAt: new Date() }).where(and(eq(dictamenes.id, input.id), eq(dictamenes.tenantId, ctx.user.tenantId), eq(dictamenes.estado, "EMITIDO")));
      if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "El dictamen cambió de estado." });
      await appendExpedienteEvent(tx, ctx, { expedienteId: current.expedienteId, tipo: "DICTAMEN_RECHAZADO", estadoAnterior: "EMITIDO", estadoNuevo: "RECHAZADO", motivo: input.motivo, payload: { dictamenId: current.id } });
    });
    const updated = await db.query.dictamenes.findFirst({ where: and(eq(dictamenes.id, input.id), eq(dictamenes.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "RECHAZAR", entidad: "dictamenes", entidadId: input.id, valorAnterior: current, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),
});
