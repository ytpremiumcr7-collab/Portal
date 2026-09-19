import { z } from "zod";
import { and, count, desc, eq, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, capabilityQuery, proveedorQuery, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { aclaracionesJuntas, aclaracionesPreguntas, aclaracionesRespuestas, proveedores, licitaciones } from "@db/schema";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";
import { assertLicitacionExists } from "../lib/domain";
import { assertAclaracionJuntaTransition } from "../lib/phase2-transitions";
import { writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";

async function providerFor(tenantId: number, userId: number) {
  const p = await getDb().query.proveedores.findFirst({ where: and(eq(proveedores.tenantId, tenantId), eq(proveedores.usuarioId, userId), eq(proveedores.activo, true)) });
  if (!p) throw new TRPCError({ code: "FORBIDDEN", message: "Sin expediente de proveedor activo." });
  return p;
}

export const aclaracionesRouter = createRouter({
  listJuntas: authedQuery.input(z.object({ licitacionId: z.number().int().positive().optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(aclaracionesJuntas.tenantId, ctx.user.tenantId)];
    if (input?.licitacionId) conditions.push(eq(aclaracionesJuntas.licitacionId, input.licitacionId));
    const where = and(...conditions);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.aclaracionesJuntas.findMany({ where, orderBy: [desc(aclaracionesJuntas.createdAt)], limit: pageSize, offset }),
      db.select({ total: count() }).from(aclaracionesJuntas).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  getJunta: authedQuery.input(z.object({ id: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const junta = await getDb().query.aclaracionesJuntas.findFirst({
      where: and(eq(aclaracionesJuntas.id, input.id), eq(aclaracionesJuntas.tenantId, ctx.user.tenantId)),
      with: { preguntas: { with: { respuesta: true, proveedor: true }, orderBy: [asc(aclaracionesPreguntas.id)] } },
    });
    if (!junta) throw new TRPCError({ code: "NOT_FOUND", message: "Junta de aclaraciones no encontrada." });
    return junta;
  }),

  crearJunta: capabilityQuery("publicar").input(z.object({
    licitacionId: z.number().int().positive(),
    nombre: z.string().trim().min(3).default("Junta de aclaraciones"),
    modalidad: z.enum(["PRESENCIAL", "VIRTUAL", "MIXTA"]).default("VIRTUAL"),
    fechaProgramada: z.string().datetime(),
    fechaLimitePreguntas: z.string().datetime(),
    lugarOEnlace: z.string().trim().max(500).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const lic = await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    if (!["BORRADOR", "PUBLICADA", "CONSULTAS"].includes(lic.estado)) throw new TRPCError({ code: "CONFLICT", message: "La junta sólo se abre en BORRADOR/PUBLICADA/CONSULTAS." });
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin expediente electrónico." });
    const db = getDb();
    let juntaId = 0;
    await db.transaction(async (tx) => {
      const dup = await tx.query.aclaracionesJuntas.findFirst({ where: and(eq(aclaracionesJuntas.tenantId, ctx.user.tenantId), eq(aclaracionesJuntas.licitacionId, input.licitacionId)) });
      if (dup) throw new TRPCError({ code: "CONFLICT", message: "Ya existe una junta de aclaraciones para esta licitación." });
      const result = await tx.insert(aclaracionesJuntas).values({
        tenantId: ctx.user.tenantId, expedienteId: expediente.id, licitacionId: input.licitacionId,
        nombre: input.nombre, modalidad: input.modalidad,
        fechaProgramada: new Date(input.fechaProgramada), fechaLimitePreguntas: new Date(input.fechaLimitePreguntas),
        estado: "PROGRAMADA", lugarOEnlace: input.lugarOEnlace ?? null, creadaPor: ctx.user.id,
      });
      juntaId = Number(result[0].insertId);
      await tx.update(licitaciones).set({ etapa: "JUNTA_ACLARACIONES" }).where(and(eq(licitaciones.id, input.licitacionId), eq(licitaciones.tenantId, ctx.user.tenantId)));
      await appendExpedienteEvent(tx, ctx, { expedienteId: expediente.id, tipo: "ACLARACION_JUNTA_CREADA", estadoAnterior: null, estadoNuevo: "PROGRAMADA", motivo: input.motivo, payload: { juntaId, licitacionId: input.licitacionId } });
    });
    const created = await getDb().query.aclaracionesJuntas.findFirst({ where: and(eq(aclaracionesJuntas.id, juntaId), eq(aclaracionesJuntas.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "aclaraciones_juntas", entidadId: juntaId, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  transicionarJunta: capabilityQuery("publicar").input(z.object({
    id: z.number().int().positive(),
    siguiente: z.enum(["ABIERTA", "CERRADA_PREGUNTAS", "EN_RESPUESTA", "ACTA_EMITIDA", "PUBLICADA", "CANCELADA"]),
    actaResumen: z.string().trim().min(10).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const junta = await db.query.aclaracionesJuntas.findFirst({ where: and(eq(aclaracionesJuntas.id, input.id), eq(aclaracionesJuntas.tenantId, ctx.user.tenantId)) });
    if (!junta) throw new TRPCError({ code: "NOT_FOUND", message: "Junta no encontrada." });
    assertAclaracionJuntaTransition(junta.estado as any, input.siguiente);
    if (input.siguiente === "ACTA_EMITIDA" && !input.actaResumen) throw new TRPCError({ code: "BAD_REQUEST", message: "El acta requiere resumen." });
    await db.transaction(async (tx) => {
      const patch: Record<string, unknown> = { estado: input.siguiente };
      if (input.siguiente === "CERRADA_PREGUNTAS") patch.cerradaAt = new Date();
      if (input.siguiente === "ACTA_EMITIDA") patch.actaResumen = input.actaResumen;
      if (input.siguiente === "PUBLICADA") patch.publicadaAt = new Date();
      const result = await tx.update(aclaracionesJuntas).set(patch as any).where(and(eq(aclaracionesJuntas.id, input.id), eq(aclaracionesJuntas.tenantId, ctx.user.tenantId), eq(aclaracionesJuntas.estado, junta.estado)));
      if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "La junta cambió de estado." });
      await appendExpedienteEvent(tx, ctx, { expedienteId: junta.expedienteId, tipo: `ACLARACION_JUNTA_${input.siguiente}`, estadoAnterior: junta.estado, estadoNuevo: input.siguiente, motivo: input.motivo, payload: { juntaId: junta.id } });
    });
    const updated = await db.query.aclaracionesJuntas.findFirst({ where: and(eq(aclaracionesJuntas.id, input.id), eq(aclaracionesJuntas.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "TRANSICION", entidad: "aclaraciones_juntas", entidadId: input.id, valorAnterior: junta, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),

  formularPregunta: proveedorQuery.input(z.object({ juntaId: z.number().int().positive(), pregunta: z.string().trim().min(10).max(4000) })).mutation(async ({ input, ctx }) => {
    const provider = await providerFor(ctx.user.tenantId, ctx.user.id);
    const db = getDb();
    const junta = await db.query.aclaracionesJuntas.findFirst({ where: and(eq(aclaracionesJuntas.id, input.juntaId), eq(aclaracionesJuntas.tenantId, ctx.user.tenantId)) });
    if (!junta) throw new TRPCError({ code: "NOT_FOUND", message: "Junta no encontrada." });
    if (junta.estado !== "ABIERTA") throw new TRPCError({ code: "CONFLICT", message: "Sólo se admiten preguntas con la junta ABIERTA." });
    if (junta.fechaLimitePreguntas < new Date()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Venció el plazo de preguntas." });
    let id = 0;
    await db.transaction(async (tx) => {
      const n = await tx.select({ total: count() }).from(aclaracionesPreguntas).where(and(eq(aclaracionesPreguntas.tenantId, ctx.user.tenantId), eq(aclaracionesPreguntas.juntaId, input.juntaId)));
      const folio = `P-${String(Number(n[0]?.total ?? 0) + 1).padStart(4, "0")}`;
      const result = await tx.insert(aclaracionesPreguntas).values({
        tenantId: ctx.user.tenantId, juntaId: input.juntaId, licitacionId: junta.licitacionId,
        proveedorId: provider.id, folio, pregunta: input.pregunta, estado: "RECIBIDA", creadaPor: ctx.user.id,
      });
      id = Number(result[0].insertId);
      await appendExpedienteEvent(tx, ctx, { expedienteId: junta.expedienteId, tipo: "ACLARACION_PREGUNTA", estadoAnterior: null, estadoNuevo: "RECIBIDA", motivo: "Pregunta formulada", payload: { preguntaId: id, juntaId: junta.id, folio } });
    });
    return getDb().query.aclaracionesPreguntas.findFirst({ where: and(eq(aclaracionesPreguntas.id, id), eq(aclaracionesPreguntas.tenantId, ctx.user.tenantId)) });
  }),

  responderPregunta: capabilityQuery("publicar").input(z.object({
    preguntaId: z.number().int().positive(),
    respuesta: z.string().trim().min(5).max(8000),
    esPublica: z.boolean().default(true),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const pregunta = await db.query.aclaracionesPreguntas.findFirst({ where: and(eq(aclaracionesPreguntas.id, input.preguntaId), eq(aclaracionesPreguntas.tenantId, ctx.user.tenantId)) });
    if (!pregunta) throw new TRPCError({ code: "NOT_FOUND", message: "Pregunta no encontrada." });
    if (!["RECIBIDA", "ADMITIDA"].includes(pregunta.estado)) throw new TRPCError({ code: "CONFLICT", message: "La pregunta no admite respuesta." });
    const junta = await db.query.aclaracionesJuntas.findFirst({ where: and(eq(aclaracionesJuntas.id, pregunta.juntaId), eq(aclaracionesJuntas.tenantId, ctx.user.tenantId)) });
    if (!junta || !["EN_RESPUESTA", "CERRADA_PREGUNTAS", "ABIERTA"].includes(junta.estado)) throw new TRPCError({ code: "CONFLICT", message: "La junta no está en fase de respuestas." });
    let respId = 0;
    await db.transaction(async (tx) => {
      const result = await tx.insert(aclaracionesRespuestas).values({
        tenantId: ctx.user.tenantId, preguntaId: pregunta.id, juntaId: pregunta.juntaId,
        respuesta: input.respuesta, esPublica: input.esPublica, respondidaPor: ctx.user.id,
      });
      respId = Number(result[0].insertId);
      await tx.update(aclaracionesPreguntas).set({ estado: "RESPONDIDA" }).where(and(eq(aclaracionesPreguntas.id, pregunta.id), eq(aclaracionesPreguntas.tenantId, ctx.user.tenantId)));
      await appendExpedienteEvent(tx, ctx, { expedienteId: junta!.expedienteId, tipo: "ACLARACION_RESPUESTA", estadoAnterior: pregunta.estado, estadoNuevo: "RESPONDIDA", motivo: input.motivo, payload: { preguntaId: pregunta.id, respuestaId: respId } });
    });
    const created = await db.query.aclaracionesRespuestas.findFirst({ where: and(eq(aclaracionesRespuestas.id, respId), eq(aclaracionesRespuestas.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "RESPONDER", entidad: "aclaraciones_respuestas", entidadId: respId, valorNuevo: created, motivo: input.motivo });
    return created;
  }),
});
