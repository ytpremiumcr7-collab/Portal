import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { createRouter, procedureMutation, authedQuery, ctxForAudit } from "../middleware";
import { licitacionIdFromInput } from "../lib/procedure-resolvers";
import { getDb } from "../queries/connection";
import { actosDesempate, licitaciones, documentos, licitacionReglasVersion, participaciones } from "@db/schema";
import { writeAudit } from "../lib/security";
import { assertDocumentoBoundToContext } from "../lib/documento-binding";
import { computeEmpateSet, assertSorteoResultadoValid, type CriterioEvaluacion } from "../lib/evaluation-engine";
import { parseTieBreakPolicy } from "../lib/procedure-policy";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";

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

  emitir: procedureMutation({ capability: "emitir_desempate", roles: ["dictaminador", "autorizador_fallo", "evaluador_economico"], resolveLicitacionId: (i) => licitacionIdFromInput(i) }).input(z.object({
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
    const frozen = await db.query.licitacionReglasVersion.findFirst({
      where: and(eq(licitacionReglasVersion.tenantId, ctx.user.tenantId), eq(licitacionReglasVersion.licitacionId, input.licitacionId)),
      orderBy: [desc(licitacionReglasVersion.version)],
    });
    const tb = parseTieBreakPolicy(frozen?.tieBreakPolicy);
    if (tb.includes("sorteo_documentado") && input.metodo === "OTRO") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "La política congelada exige sorteo_documentado; método OTRO rechazado." });
    }
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

  registrarResultado: procedureMutation({ capability: "emitir_desempate", roles: ["dictaminador", "autorizador_fallo"], resolveLicitacionId: (i) => licitacionIdFromInput(i) }).input(z.object({
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
    const frozen = await db.query.licitacionReglasVersion.findFirst({
      where: and(eq(licitacionReglasVersion.tenantId, ctx.user.tenantId), eq(licitacionReglasVersion.licitacionId, input.licitacionId)),
      orderBy: [desc(licitacionReglasVersion.version)],
    });
    if (!frozen) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin reglas congeladas." });
    const tb = parseTieBreakPolicy(frozen.tieBreakPolicy);
    const policyRequiresSorteo = tb.includes("sorteo_documentado");
    if (policyRequiresSorteo && acto.metodo === "OTRO") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "La política exige sorteo_documentado; el acto OTRO no puede registrarse." });
    }
    if (input.evidenciaDocId) {
      const doc = await db.query.documentos.findFirst({
        where: and(eq(documentos.id, input.evidenciaDocId), eq(documentos.tenantId, ctx.user.tenantId)),
      });
      const expedienteForBind = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
      assertDocumentoBoundToContext(doc as any, {
        tenantId: ctx.user.tenantId,
        licitacionId: input.licitacionId,
        expedienteId: expedienteForBind?.id ?? null,
        expectedTipo: doc?.tipo ?? "ACTA_EVALUACION",
      });
      if (!doc || !["ACTA_EVALUACION", "ACTA_APERTURA", "DICTAMEN", "OTRO"].includes(doc.tipo)) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Evidencia de desempate: se requiere documento APROBADO/vigente vinculado al procedimiento." });
      }
    }
    const admisibles = await db.query.participaciones.findMany({
      where: and(
        eq(participaciones.tenantId, ctx.user.tenantId),
        eq(participaciones.licitacionId, input.licitacionId),
        eq(participaciones.estadoEvaluacion, "ADMISIBLE"),
      ),
    });
    const empateSet = computeEmpateSet(
      frozen.criterioEvaluacion as CriterioEvaluacion,
      admisibles.map((a) => ({
        id: a.id,
        montoOferta: a.montoOferta,
        puntajeTecnico: a.puntajeTecnico,
        puntajeEconomico: a.puntajeEconomico,
        puntajeTotal: a.puntajeTotal,
        recibidoAt: (a as any).recibidoAt,
      })),
      tb,
    );
    assertSorteoResultadoValid({
      policyRequiresSorteo,
      metodo: acto.metodo,
      evidenciaDocId: input.evidenciaDocId,
      orden: input.orden,
      empateSet,
    });
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
