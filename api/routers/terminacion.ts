import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, capabilityQuery, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { actosTerminacion, licitaciones } from "@db/schema";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";
import { assertLicitacionExists } from "../lib/domain";
import { writeAudit } from "../lib/security";
import { enqueueOutbox } from "../lib/outbox";

export const terminacionRouter = createRouter({
  list: authedQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    return getDb().query.actosTerminacion.findMany({
      where: and(eq(actosTerminacion.tenantId, ctx.user.tenantId), eq(actosTerminacion.licitacionId, input.licitacionId)),
    });
  }),

  crear: capabilityQuery("publicar").input(z.object({
    licitacionId: z.number().int().positive(),
    tipo: z.enum(["CANCELACION", "DESIERTO"]),
    causa: z.string().trim().min(10),
    fundamento: z.string().trim().min(10),
    documentoId: z.number().int().positive().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const lic = await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    if (["ADJUDICADA", "FINALIZADA", "ARCHIVADA"].includes(lic.estado)) {
      throw new TRPCError({ code: "CONFLICT", message: "El procedimiento ya está cerrado." });
    }
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin expediente." });
    const db = getDb();
    const result = await db.insert(actosTerminacion).values({
      tenantId: ctx.user.tenantId, licitacionId: input.licitacionId, expedienteId: expediente.id,
      tipo: input.tipo, causa: input.causa, fundamento: input.fundamento,
      documentoId: input.documentoId ?? null, estado: "BORRADOR", creadoPor: ctx.user.id,
    } as any);
    const id = Number(result[0].insertId);
    return db.query.actosTerminacion.findFirst({ where: and(eq(actosTerminacion.id, id), eq(actosTerminacion.tenantId, ctx.user.tenantId)) });
  }),

  publicar: capabilityQuery("publicar").input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const acto = await db.query.actosTerminacion.findFirst({
      where: and(eq(actosTerminacion.id, input.id), eq(actosTerminacion.tenantId, ctx.user.tenantId)),
    });
    if (!acto) throw new TRPCError({ code: "NOT_FOUND", message: "Acto no encontrado." });
    if (acto.estado !== "BORRADOR") throw new TRPCError({ code: "CONFLICT", message: "Ya publicado." });
    const nextEstado = acto.tipo === "DESIERTO" ? "DESIERTA" : "CANCELADA";
    const eventType = acto.tipo === "DESIERTO" ? "PROCEDIMIENTO_DESIERTO" : "PROCEDIMIENTO_CANCELADO";
    await db.transaction(async (tx) => {
      await tx.update(actosTerminacion).set({ estado: "PUBLICADO", publicadoAt: new Date() } as any)
        .where(and(eq(actosTerminacion.id, input.id), eq(actosTerminacion.tenantId, ctx.user.tenantId)));
      const result = await tx.update(licitaciones).set({ estado: nextEstado as any })
        .where(and(eq(licitaciones.id, acto.licitacionId), eq(licitaciones.tenantId, ctx.user.tenantId)));
      if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "No se pudo actualizar el procedimiento." });
      await appendExpedienteEvent(tx, ctx, {
        expedienteId: acto.expedienteId, tipo: eventType,
        estadoAnterior: null, estadoNuevo: nextEstado, motivo: input.motivo,
        payload: { actoId: input.id, tipo: acto.tipo, causa: acto.causa, fundamento: acto.fundamento, documentoId: acto.documentoId },
      });
      await enqueueOutbox(tx, {
        tenantId: ctx.user.tenantId, aggregateType: "actos_terminacion", aggregateId: input.id,
        eventType,
        payload: {
          actoId: input.id, licitacionId: acto.licitacionId, actorUserId: ctx.user.id,
          asunto: `${acto.tipo} del procedimiento #${acto.licitacionId}`,
          cuerpo: acto.causa, entidadRef: "actos_terminacion", entidadId: input.id,
        },
      });
    });
    const updated = await db.query.actosTerminacion.findFirst({ where: and(eq(actosTerminacion.id, input.id), eq(actosTerminacion.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "PUBLICAR", entidad: "actos_terminacion", entidadId: input.id, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),
});
