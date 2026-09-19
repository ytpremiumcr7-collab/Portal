import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, convocanteQuery, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { actoAdjudicacion, participaciones, licitacionReglasVersion } from "@db/schema";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";
import { assertLicitacionExists } from "../lib/domain";
import { rankAdmisibles, type CriterioEvaluacion } from "../lib/evaluation-engine";
import { parseTieBreakPolicy } from "../lib/procedure-policy";
import { writeAudit } from "../lib/security";
import { enqueueOutbox } from "../lib/outbox";
import { assertCalendarioPermite } from "../lib/calendario-gates";

export const actoAdjudicacionRouter = createRouter({
  getByLicitacion: authedQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    return getDb().query.actoAdjudicacion.findFirst({
      where: and(eq(actoAdjudicacion.tenantId, ctx.user.tenantId), eq(actoAdjudicacion.licitacionId, input.licitacionId)),
    });
  }),

  /** System ranking proposal + authority decision foundation. */
  proponer: convocanteQuery.input(z.object({
    licitacionId: z.number().int().positive(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const lic = await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    if (lic.estado !== "EN_EVALUACION") throw new TRPCError({ code: "CONFLICT", message: "El acto de adjudicación se propone en EN_EVALUACION." });
    await assertCalendarioPermite(ctx.user.tenantId, input.licitacionId, "ADJUDICACION");
    const db = getDb();
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin expediente." });
    const frozen = await db.query.licitacionReglasVersion.findFirst({
      where: and(eq(licitacionReglasVersion.tenantId, ctx.user.tenantId), eq(licitacionReglasVersion.licitacionId, input.licitacionId)),
      orderBy: [desc(licitacionReglasVersion.version)],
    });
    if (!frozen) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin reglas congeladas." });
    const admisibles = await db.select({
      id: participaciones.id, proveedorId: participaciones.proveedorId,
      montoOferta: participaciones.montoOferta, puntajeTecnico: participaciones.puntajeTecnico,
      puntajeEconomico: participaciones.puntajeEconomico, puntajeTotal: participaciones.puntajeTotal,
      recibidoAt: participaciones.recibidoAt,
    }).from(participaciones).where(and(
      eq(participaciones.tenantId, ctx.user.tenantId), eq(participaciones.licitacionId, input.licitacionId),
      eq(participaciones.estadoEvaluacion, "ADMISIBLE"),
    ));
    if (!admisibles.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No hay ofertas admisibles." });
    const tb = parseTieBreakPolicy((frozen as any).tieBreakPolicy);
    const rankedIds = rankAdmisibles(frozen.criterioEvaluacion as CriterioEvaluacion, admisibles, tb);
    const ranking = rankedIds.map((id, i) => {
      const o = admisibles.find((a) => a.id === id)!;
      return { orden: i + 1, participacionId: o.id, proveedorId: o.proveedorId, montoOferta: o.montoOferta, puntajeTotal: o.puntajeTotal };
    });
    const propuesto = ranking[0];
    let id = 0;
    await db.transaction(async (tx) => {
      const dup = await tx.query.actoAdjudicacion.findFirst({
        where: and(eq(actoAdjudicacion.tenantId, ctx.user.tenantId), eq(actoAdjudicacion.licitacionId, input.licitacionId)),
      });
      if (dup && dup.estado === "PUBLICADO") throw new TRPCError({ code: "CONFLICT", message: "Ya existe un acto PUBLICADO." });
      if (dup) {
        await tx.update(actoAdjudicacion).set({
          propuestaRankingJson: ranking, proveedorPropuestoId: propuesto.proveedorId,
          estado: "PROPUESTO", validadoVsRanking: true, creadoPor: ctx.user.id,
        } as any).where(and(eq(actoAdjudicacion.id, dup.id), eq(actoAdjudicacion.tenantId, ctx.user.tenantId)));
        id = dup.id;
      } else {
        const result = await tx.insert(actoAdjudicacion).values({
          tenantId: ctx.user.tenantId, licitacionId: input.licitacionId, expedienteId: expediente.id,
          propuestaRankingJson: ranking, proveedorPropuestoId: propuesto.proveedorId,
          estado: "PROPUESTO", validadoVsRanking: true, creadoPor: ctx.user.id,
        } as any);
        id = Number(result[0].insertId);
      }
      await appendExpedienteEvent(tx, ctx, {
        expedienteId: expediente.id, tipo: "ACTO_ADJUDICACION_PROPUESTO",
        estadoAnterior: null, estadoNuevo: "PROPUESTO", motivo: input.motivo,
        payload: { actoId: id, proveedorPropuestoId: propuesto.proveedorId, ranking },
      });
    });
    const created = await db.query.actoAdjudicacion.findFirst({ where: and(eq(actoAdjudicacion.id, id), eq(actoAdjudicacion.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "PROPONER", entidad: "acto_adjudicacion", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  decidir: convocanteQuery.input(z.object({
    id: z.number().int().positive(),
    proveedorId: z.number().int().positive(),
    fundamento: z.string().trim().min(10),
    desviacionJustificada: z.boolean().default(false),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const acto = await db.query.actoAdjudicacion.findFirst({
      where: and(eq(actoAdjudicacion.id, input.id), eq(actoAdjudicacion.tenantId, ctx.user.tenantId)),
    });
    if (!acto) throw new TRPCError({ code: "NOT_FOUND", message: "Acto no encontrado." });
    if (!["BORRADOR", "PROPUESTO"].includes(acto.estado)) throw new TRPCError({ code: "CONFLICT", message: "El acto no admite decisión." });
    const matchesRanking = Number(acto.proveedorPropuestoId) === Number(input.proveedorId);
    if (!matchesRanking && !input.desviacionJustificada) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "La decisión se desvía del ranking del sistema; marque desviacionJustificada y fundamente.",
      });
    }
    await db.transaction(async (tx) => {
      await tx.update(actoAdjudicacion).set({
        proveedorDecididoId: input.proveedorId, fundamento: input.fundamento,
        desviacionJustificada: !matchesRanking, decididoPor: ctx.user.id, estado: "PROPUESTO",
        validadoVsRanking: matchesRanking,
      } as any).where(and(eq(actoAdjudicacion.id, input.id), eq(actoAdjudicacion.tenantId, ctx.user.tenantId)));
      await appendExpedienteEvent(tx, ctx, {
        expedienteId: acto.expedienteId, tipo: "ACTO_ADJUDICACION_DECIDIDO",
        estadoAnterior: acto.estado, estadoNuevo: "PROPUESTO", motivo: input.motivo,
        payload: { actoId: input.id, proveedorId: input.proveedorId, matchesRanking, fundamento: input.fundamento },
      });
    });
    return db.query.actoAdjudicacion.findFirst({ where: and(eq(actoAdjudicacion.id, input.id), eq(actoAdjudicacion.tenantId, ctx.user.tenantId)) });
  }),

  publicar: convocanteQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const acto = await db.query.actoAdjudicacion.findFirst({
      where: and(eq(actoAdjudicacion.id, input.id), eq(actoAdjudicacion.tenantId, ctx.user.tenantId)),
    });
    if (!acto) throw new TRPCError({ code: "NOT_FOUND", message: "Acto no encontrado." });
    if (acto.estado !== "PROPUESTO") throw new TRPCError({ code: "CONFLICT", message: "Sólo un acto PROPUESTO se publica." });
    if (!acto.proveedorDecididoId && !acto.proveedorPropuestoId) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Falta decisión de autoridad." });
    }
    if (!acto.fundamento && Number(acto.proveedorDecididoId ?? acto.proveedorPropuestoId) !== Number(acto.proveedorPropuestoId)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Desviación del ranking requiere fundamento." });
    }
    await db.transaction(async (tx) => {
      const result = await tx.update(actoAdjudicacion).set({
        estado: "PUBLICADO", publicadoAt: new Date(),
        proveedorDecididoId: acto.proveedorDecididoId ?? acto.proveedorPropuestoId,
        fundamento: acto.fundamento ?? "Conforme al ranking del sistema y política congelada.",
      } as any).where(and(eq(actoAdjudicacion.id, input.id), eq(actoAdjudicacion.tenantId, ctx.user.tenantId), eq(actoAdjudicacion.estado, "PROPUESTO")));
      if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "El acto cambió de estado." });
      await appendExpedienteEvent(tx, ctx, {
        expedienteId: acto.expedienteId, tipo: "ACTO_ADJUDICACION_PUBLICADO",
        estadoAnterior: "PROPUESTO", estadoNuevo: "PUBLICADO", motivo: input.motivo,
        payload: { actoId: input.id },
      });
      await enqueueOutbox(tx, {
        tenantId: ctx.user.tenantId, aggregateType: "acto_adjudicacion", aggregateId: input.id,
        eventType: "ACTO_ADJUDICACION_PUBLICADO",
        payload: {
          actoId: input.id, licitacionId: acto.licitacionId, actorUserId: ctx.user.id,
          asunto: `Acto de adjudicación publicado #${input.id}`,
          cuerpo: input.motivo, entidadRef: "acto_adjudicacion", entidadId: input.id,
        },
      });
    });
    const updated = await db.query.actoAdjudicacion.findFirst({ where: and(eq(actoAdjudicacion.id, input.id), eq(actoAdjudicacion.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "PUBLICAR", entidad: "acto_adjudicacion", entidadId: input.id, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),
});
