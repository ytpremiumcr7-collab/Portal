import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { createRouter, capabilityQuery, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { actosDesempate, licitaciones, documentos } from "@db/schema";
import { writeAudit } from "../lib/security";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";
import { assertProcedimientoAsignacion } from "../lib/sod";

const ordenSchema = z.array(z.object({
  participacionId: z.number().int().positive(),
  orden: z.number().int().positive(),
})).min(2);

export const desempateRouter = createRouter({
  getByLicitacion: authedQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    return getDb().query.actosDesempate.findFirst({
      where: and(eq(actosDesempate.tenantId, ctx.user.tenantId), eq(actosDesempate.licitacionId, input.licitacionId)),
    });
  }),

  emitir: capabilityQuery("emitir_desempate").input(z.object({
    licitacionId: z.number().int().positive(),
    metodo: z.enum(["SORTEO_DOCUMENTADO", "OTRO"]).default("SORTEO_DOCUMENTADO"),
    semilla: z.string().trim().min(3).max(128).optional(),
    actores: z.array(z.object({ userId: z.number().int().positive(), rol: z.string().trim().min(2) })).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const lic = await db.query.licitaciones.findFirst({
      where: and(eq(licitaciones.id, input.licitacionId), eq(licitaciones.tenantId, ctx.user.tenantId)),
    });
    if (!lic) throw new TRPCError({ code: "NOT_FOUND", message: "Licitación no encontrada." });
    await assertProcedimientoAsignacion(ctx.user, input.licitacionId, ["dictaminador", "autorizador_fallo", "evaluador_economico"]);
    const existing = await db.query.actosDesempate.findFirst({
      where: and(eq(actosDesempate.tenantId, ctx.user.tenantId), eq(actosDesempate.licitacionId, input.licitacionId)),
    });
    if (existing && existing.estado === "REGISTRADO") {
      throw new TRPCError({ code: "CONFLICT", message: "Ya existe un acto de desempate REGISTRADO." });
    }
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    let id = existing?.id ?? 0;
    await db.transaction(async (tx) => {
      if (existing) {
        await tx.update(actosDesempate).set({
          metodo: input.metodo,
          semilla: input.semilla ?? existing.semilla,
          actoresJson: input.actores ?? existing.actoresJson,
          estado: "EMITIDO",
          emitidoPor: ctx.user.id,
        } as any).where(and(eq(actosDesempate.id, existing.id), eq(actosDesempate.tenantId, ctx.user.tenantId)));
        id = existing.id;
      } else {
        const result = await tx.insert(actosDesempate).values({
          tenantId: ctx.user.tenantId,
          licitacionId: input.licitacionId,
          metodo: input.metodo,
          semilla: input.semilla ?? null,
          actoresJson: input.actores ?? null,
          estado: "EMITIDO",
          emitidoPor: ctx.user.id,
        } as any);
        id = Number(result[0].insertId);
      }
      if (expediente) {
        await appendExpedienteEvent(tx, ctx, {
          expedienteId: expediente.id,
          tipo: "ACTO_DESEMPATE_EMITIDO",
          estadoAnterior: existing?.estado ?? null,
          estadoNuevo: "EMITIDO",
          motivo: input.motivo,
          payload: { actoDesempateId: id, metodo: input.metodo, semilla: input.semilla ?? null },
        });
      }
      await writeAudit({
        ctx: ctxForAudit(ctx), accion: "EMITIR_DESEMPATE", entidad: "actos_desempate", entidadId: id,
        motivo: input.motivo, tx,
      });
    });
    return db.query.actosDesempate.findFirst({
      where: and(eq(actosDesempate.id, id), eq(actosDesempate.tenantId, ctx.user.tenantId)),
    });
  }),

  registrarResultado: capabilityQuery("emitir_desempate").input(z.object({
    licitacionId: z.number().int().positive(),
    orden: ordenSchema,
    evidenciaDocId: z.number().int().positive().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const acto = await db.query.actosDesempate.findFirst({
      where: and(eq(actosDesempate.tenantId, ctx.user.tenantId), eq(actosDesempate.licitacionId, input.licitacionId)),
    });
    if (!acto || !["EMITIDO", "BORRADOR"].includes(acto.estado)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Debe emitir el acto de desempate antes de registrar el resultado." });
    }
    await assertProcedimientoAsignacion(ctx.user, input.licitacionId, ["dictaminador", "autorizador_fallo"]);
    if (input.evidenciaDocId) {
      const doc = await db.query.documentos.findFirst({
        where: and(eq(documentos.id, input.evidenciaDocId), eq(documentos.tenantId, ctx.user.tenantId)),
      });
      if (!doc) throw new TRPCError({ code: "BAD_REQUEST", message: "Documento de evidencia no válido." });
    }
    const ordenIds = input.orden.map((o) => o.orden);
    if (new Set(ordenIds).size !== ordenIds.length) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "El orden de desempate no puede tener posiciones duplicadas." });
    }
    const resultadoHash = createHash("sha256")
      .update(JSON.stringify({ orden: input.orden, semilla: acto.semilla, licitacionId: input.licitacionId }))
      .digest("hex");
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    await db.transaction(async (tx) => {
      await tx.update(actosDesempate).set({
        resultadoJson: input.orden,
        evidenciaDocId: input.evidenciaDocId ?? null,
        resultadoHash,
        estado: "REGISTRADO",
        registradoPor: ctx.user.id,
        registradoAt: new Date(),
      } as any).where(and(eq(actosDesempate.id, acto.id), eq(actosDesempate.tenantId, ctx.user.tenantId)));
      if (expediente) {
        await appendExpedienteEvent(tx, ctx, {
          expedienteId: expediente.id,
          tipo: "ACTO_DESEMPATE_REGISTRADO",
          estadoAnterior: acto.estado,
          estadoNuevo: "REGISTRADO",
          motivo: input.motivo,
          payload: { actoDesempateId: acto.id, resultadoHash, orden: input.orden },
        });
      }
      await writeAudit({
        ctx: ctxForAudit(ctx), accion: "REGISTRAR_DESEMPATE", entidad: "actos_desempate", entidadId: acto.id,
        valorNuevo: { resultadoHash, orden: input.orden }, motivo: input.motivo, tx,
      });
    });
    return db.query.actosDesempate.findFirst({
      where: and(eq(actosDesempate.id, acto.id), eq(actosDesempate.tenantId, ctx.user.tenantId)),
    });
  }),
});
