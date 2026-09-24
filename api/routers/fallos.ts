import { z } from "zod";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { assertTransitionAllowed, mergeModalidadRequisitos, parseTieBreakPolicy } from "../lib/procedure-policy";
import { createRouter, procedureMutation, authedQuery, ctxForAudit } from "../middleware";
import { licitacionIdFromInput, licitacionIdFromFallo } from "../lib/procedure-resolvers";
import { getDb } from "../queries/connection";
import {
  alertasSeguridad,
  actosDesempate,
  dictamenes,
  fallos,
  licitaciones,
  licitacionReglasVersion,
  participaciones,
  proposiciones,
  proveedores,
} from "@db/schema";
import { awards, falloLotDecisions, procedureLots } from "@db/schema-eproc";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";
import { assertLicitacionExists } from "../lib/domain";
import { assertFalloTransition } from "../lib/phase2-transitions";
import type { FalloEstado } from "../lib/phase2-transitions";
import { writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";
import { assertEvaluacionesCompletas } from "../lib/eval-completeness";
import { enqueueOutbox } from "../lib/outbox";
import { assertProposicionesListasParaDictamen } from "../lib/proposicion";
import { resolveFalloLotDecisions } from "../lib/eproc-core";
import { assertProveedorPuedeAdjudicarse } from "../lib/sanciones-gate";
import { assertCalendarioPermite } from "../lib/calendario-gates";
import { recordPublicationRelease } from "../lib/publication-ledger";
import { assertIsPrimerLugar, parseDesempateOrden, type CriterioEvaluacion } from "../lib/evaluation-engine";
import type { TrpcContext } from "../context";

const decisionSchema = z.object({
  lotId: z.number().int().positive(),
  outcome: z.enum(["ADJUDICAR", "DESIERTO", "CANCELAR"]),
  participationId: z.number().int().positive().optional(),
  reason: z.string().trim().min(20),
}).superRefine((decision, ctx) => {
  if (decision.outcome === "ADJUDICAR" && !decision.participationId) {
    ctx.addIssue({ code: "custom", path: ["participationId"], message: "ADJUDICAR requiere una oferta admisible." });
  }
  if (decision.outcome !== "ADJUDICAR" && decision.participationId) {
    ctx.addIssue({ code: "custom", path: ["participationId"], message: "Sólo una adjudicación puede señalar oferta." });
  }
});

async function falloBundle(tenantId: number, falloId: number) {
  const db = getDb();
  const fallo = await db.query.fallos.findFirst({
    where: and(eq(fallos.id, falloId), eq(fallos.tenantId, tenantId)),
  });
  if (!fallo) return null;
  const [decisions, awardRows] = await Promise.all([
    db.select({
      id: falloLotDecisions.id,
      falloId: falloLotDecisions.falloId,
      lotId: falloLotDecisions.lotId,
      lotCode: procedureLots.code,
      lotTitle: procedureLots.title,
      outcome: falloLotDecisions.outcome,
      participacionId: falloLotDecisions.participacionId,
      proveedorId: falloLotDecisions.proveedorId,
      proveedor: proveedores.razonSocial,
      amount: falloLotDecisions.amount,
      currency: falloLotDecisions.currency,
      reason: falloLotDecisions.reason,
    }).from(falloLotDecisions)
      .innerJoin(procedureLots, and(
        eq(procedureLots.tenantId, falloLotDecisions.tenantId),
        eq(procedureLots.id, falloLotDecisions.lotId),
      ))
      .leftJoin(proveedores, and(
        eq(proveedores.tenantId, falloLotDecisions.tenantId),
        eq(proveedores.id, falloLotDecisions.proveedorId),
      ))
      .where(and(eq(falloLotDecisions.tenantId, tenantId), eq(falloLotDecisions.falloId, falloId)))
      .orderBy(asc(procedureLots.id)),
    db.select().from(awards)
      .where(and(eq(awards.tenantId, tenantId), eq(awards.falloId, falloId)))
      .orderBy(asc(awards.lotId)),
  ]);
  return { ...fallo, decisions, awards: awardRows };
}

export const fallosRouter = createRouter({
  list: authedQuery.input(z.object({
    licitacionId: z.number().int().positive().optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(100).optional(),
  }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(fallos.tenantId, ctx.user.tenantId)];
    if (input?.licitacionId) conditions.push(eq(fallos.licitacionId, input.licitacionId));
    const where = and(...conditions);
    const db = getDb();
    const [rows, totalRows] = await Promise.all([
      db.query.fallos.findMany({ where, orderBy: [desc(fallos.createdAt)], limit: pageSize, offset }),
      db.select({ total: count() }).from(fallos).where(where),
    ]);
    const items = await Promise.all(rows.map((row) => falloBundle(ctx.user.tenantId, row.id)));
    return pageResult(items.filter((item): item is NonNullable<typeof item> => item != null), Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  getByLicitacion: authedQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const row = await getDb().query.fallos.findFirst({
      where: and(eq(fallos.tenantId, ctx.user.tenantId), eq(fallos.licitacionId, input.licitacionId)),
      columns: { id: true },
    });
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Fallo no encontrado." });
    return falloBundle(ctx.user.tenantId, row.id);
  }),

  prepararBorrador: authedQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const lic = await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    const db = getDb();
    const [dictamen, lots, offerRows, existing] = await Promise.all([
      db.query.dictamenes.findFirst({
        where: and(
          eq(dictamenes.tenantId, ctx.user.tenantId),
          eq(dictamenes.licitacionId, input.licitacionId),
          eq(dictamenes.estado, "APROBADO"),
        ),
        orderBy: [desc(dictamenes.version)],
      }),
      db.query.procedureLots.findMany({
        where: and(
          eq(procedureLots.tenantId, ctx.user.tenantId),
          eq(procedureLots.licitacionId, input.licitacionId),
          eq(procedureLots.status, "ACTIVE"),
        ),
        orderBy: [asc(procedureLots.id)],
      }),
      db.select({
        id: participaciones.id,
        lotId: participaciones.lotId,
        proveedorId: participaciones.proveedorId,
        proveedor: proveedores.razonSocial,
        montoOferta: participaciones.montoOferta,
        estadoEvaluacion: participaciones.estadoEvaluacion,
        ordenMerito: participaciones.ordenMerito,
        puntajeTotal: participaciones.puntajeTotal,
      }).from(participaciones)
        .innerJoin(proveedores, and(
          eq(proveedores.tenantId, participaciones.tenantId),
          eq(proveedores.id, participaciones.proveedorId),
        ))
        .where(and(
          eq(participaciones.tenantId, ctx.user.tenantId),
          eq(participaciones.licitacionId, input.licitacionId),
          eq(participaciones.estadoEvaluacion, "ADMISIBLE"),
        ))
        .orderBy(asc(participaciones.lotId), asc(participaciones.ordenMerito)),
      db.query.fallos.findFirst({
        where: and(eq(fallos.tenantId, ctx.user.tenantId), eq(fallos.licitacionId, input.licitacionId)),
        columns: { id: true, estado: true },
      }),
    ]);
    return {
      licitacion: { id: lic.id, codigo: lic.codigo, titulo: lic.titulo, estado: lic.estado },
      dictamen: dictamen ? { id: dictamen.id, version: dictamen.version, estado: dictamen.estado } : null,
      existing,
      lots: lots.map((lot) => ({ ...lot, offers: offerRows.filter((offer) => offer.lotId === lot.id) })),
    };
  }),

  emitirBorrador: procedureMutation({
    capability: "autorizar_fallo",
    role: "autorizador_fallo",
    resolveLicitacionId: (input) => licitacionIdFromInput(input),
  }).input(z.object({
    licitacionId: z.number().int().positive(),
    dictamenId: z.number().int().positive(),
    fundamento: z.string().trim().min(20),
    decisions: z.array(decisionSchema).min(1),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const lic = await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    if (lic.estado !== "EN_EVALUACION") {
      throw new TRPCError({ code: "CONFLICT", message: "El fallo se emite con el procedimiento EN_EVALUACION." });
    }
    assertTransitionAllowed(lic.tipoLicitacion, "FALLO", mergeModalidadRequisitos(null, lic.modalidadMeta));
    await assertCalendarioPermite(ctx.user.tenantId, input.licitacionId, "ADJUDICACION");
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin expediente." });

    const db = getDb();
    const [dictamen, lotRows, offerRows, frozenRules, desempate] = await Promise.all([
      db.query.dictamenes.findFirst({
        where: and(
          eq(dictamenes.id, input.dictamenId),
          eq(dictamenes.tenantId, ctx.user.tenantId),
          eq(dictamenes.licitacionId, input.licitacionId),
          eq(dictamenes.estado, "APROBADO"),
        ),
      }),
      db.query.procedureLots.findMany({
        where: and(eq(procedureLots.tenantId, ctx.user.tenantId), eq(procedureLots.licitacionId, input.licitacionId)),
      }),
      db.query.participaciones.findMany({
        where: and(eq(participaciones.tenantId, ctx.user.tenantId), eq(participaciones.licitacionId, input.licitacionId)),
      }),
      db.query.licitacionReglasVersion.findFirst({
        where: and(
          eq(licitacionReglasVersion.tenantId, ctx.user.tenantId),
          eq(licitacionReglasVersion.licitacionId, input.licitacionId),
        ),
        orderBy: [desc(licitacionReglasVersion.version)],
      }),
      db.query.actosDesempate.findFirst({
        where: and(
          eq(actosDesempate.tenantId, ctx.user.tenantId),
          eq(actosDesempate.licitacionId, input.licitacionId),
          eq(actosDesempate.estado, "REGISTRADO"),
        ),
      }),
    ]);
    if (!dictamen) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El fallo requiere un dictamen APROBADO del mismo procedimiento." });
    if (!frozenRules) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El fallo requiere reglas de evaluación congeladas desde la publicación." });

    const resolved = resolveFalloLotDecisions({
      procedureId: input.licitacionId,
      lots: lotRows.map((lot) => ({ id: lot.id, procedureId: lot.licitacionId, status: lot.status })),
      offers: offerRows.map((offer) => ({
        id: offer.id,
        procedureId: offer.licitacionId,
        lotId: offer.lotId,
        supplierId: offer.proveedorId,
        status: offer.estadoEvaluacion,
        amount: offer.montoOferta,
      })),
      decisions: input.decisions,
    });

    const tieBreak = parseTieBreakPolicy(frozenRules.tieBreakPolicy);
    const desempateOrden = parseDesempateOrden(desempate?.resultadoJson);
    for (const decision of resolved) {
      if (decision.outcome !== "ADJUDICAR") continue;
      const offer = offerRows.find((candidate) => candidate.id === decision.participationId)!;
      const lotAdmissibleOffers = offerRows
        .filter((candidate) => candidate.lotId === decision.lotId && candidate.estadoEvaluacion === "ADMISIBLE")
        .map((candidate) => ({
          id: candidate.id,
          montoOferta: candidate.montoOferta,
          puntajeTecnico: candidate.puntajeTecnico,
          puntajeEconomico: candidate.puntajeEconomico,
          puntajeTotal: candidate.puntajeTotal,
          recibidoAt: candidate.recibidoAt,
          desempateOrden: desempateOrden.get(candidate.id) ?? null,
        }));
      assertIsPrimerLugar(
        frozenRules.criterioEvaluacion as CriterioEvaluacion,
        lotAdmissibleOffers,
        offer.id,
        tieBreak,
      );
      const provider = await db.query.proveedores.findFirst({
        where: and(
          eq(proveedores.tenantId, ctx.user.tenantId),
          eq(proveedores.id, decision.supplierId!),
          eq(proveedores.activo, true),
        ),
      });
      if (!provider || provider.estadoVerificacion !== "VERIFICADO") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `El proveedor del lote #${decision.lotId} no está activo y VERIFICADO.` });
      }
      await assertProveedorPuedeAdjudicarse(ctx.user.tenantId, provider.id);
    }

    const summary = resolved.some((decision) => decision.outcome === "ADJUDICAR")
      ? "ADJUDICAR"
      : resolved.every((decision) => decision.outcome === "DESIERTO")
        ? "DESIERTO"
        : "CANCELAR";
    let id = 0;
    await db.transaction(async (tx) => {
      const duplicate = await tx.query.fallos.findFirst({
        where: and(eq(fallos.tenantId, ctx.user.tenantId), eq(fallos.licitacionId, input.licitacionId)),
      });
      if (duplicate) throw new TRPCError({ code: "CONFLICT", message: "Ya existe un fallo para este procedimiento." });

      const result = await tx.insert(fallos).values({
        tenantId: ctx.user.tenantId,
        expedienteId: expediente.id,
        licitacionId: input.licitacionId,
        dictamenId: input.dictamenId,
        estado: "BORRADOR",
        sentido: summary,
        proveedorGanadorId: null,
        montoAdjudicado: null,
        fundamento: input.fundamento,
      });
      id = Number(result[0].insertId);

      const persistedDecisions: Array<Record<string, unknown>> = [];
      for (const decision of resolved) {
        const inserted = await tx.insert(falloLotDecisions).values({
          tenantId: ctx.user.tenantId,
          falloId: id,
          licitacionId: input.licitacionId,
          lotId: decision.lotId,
          outcome: decision.outcome,
          participacionId: decision.participationId,
          proveedorId: decision.supplierId,
          amount: decision.amount,
          currency: "MXN",
          reason: decision.reason,
          decidedBy: ctx.user.id,
        });
        const decisionId = Number(inserted[0].insertId);
        let awardId: number | null = null;
        if (decision.outcome === "ADJUDICAR") {
          const awardResult = await tx.insert(awards).values({
            tenantId: ctx.user.tenantId,
            licitacionId: input.licitacionId,
            lotId: decision.lotId,
            proveedorId: decision.supplierId!,
            falloId: id,
            falloDecisionId: decisionId,
            status: "DRAFT",
            amount: decision.amount!,
            currency: "MXN",
            reason: decision.reason,
            decidedBy: ctx.user.id,
          });
          awardId = Number(awardResult[0].insertId);
        }
        persistedDecisions.push({ ...decision, id: decisionId, awardId });
      }

      await tx.update(licitaciones).set({ etapa: "FALLO" }).where(and(
        eq(licitaciones.id, input.licitacionId),
        eq(licitaciones.tenantId, ctx.user.tenantId),
      ));
      await appendExpedienteEvent(tx, ctx, {
        expedienteId: expediente.id,
        tipo: "FALLO_BORRADOR",
        estadoAnterior: null,
        estadoNuevo: "BORRADOR",
        motivo: input.motivo,
        payload: { falloId: id, decisions: persistedDecisions },
      });
      await writeAudit({
        ctx: ctxForAudit(ctx),
        accion: "CREAR",
        entidad: "fallos",
        entidadId: id,
        valorNuevo: { falloId: id, dictamenId: input.dictamenId, decisions: persistedDecisions },
        motivo: input.motivo,
        tx,
      });
    });
    return falloBundle(ctx.user.tenantId, id);
  }),

  emitir: procedureMutation({
    capability: "autorizar_fallo",
    role: "autorizador_fallo",
    resolveLicitacionId: (input, ctx) => licitacionIdFromFallo(input, ctx.user!.tenantId),
  }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) =>
    transition(ctx, input.id, "EMITIDO", input.motivo, { emitidoPor: ctx.user.id, emitidoAt: new Date() })),

  aprobar: procedureMutation({
    capability: "autorizar_fallo",
    role: "autorizador_fallo",
    resolveLicitacionId: (input, ctx) => licitacionIdFromFallo(input, ctx.user!.tenantId),
  }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) =>
    transition(ctx, input.id, "APROBADO", input.motivo, { aprobadoPor: ctx.user.id, aprobadoAt: new Date() })),

  publicar: procedureMutation({
    capability: "autorizar_fallo",
    role: "autorizador_fallo",
    resolveLicitacionId: (input, ctx) => licitacionIdFromFallo(input, ctx.user!.tenantId),
  }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) =>
    transition(ctx, input.id, "PUBLICADO", input.motivo, { publicadoAt: new Date() })),
});

type AuthenticatedContext = TrpcContext & { user: NonNullable<TrpcContext["user"]> };

async function transition(
  ctx: AuthenticatedContext,
  id: number,
  next: "EMITIDO" | "APROBADO" | "PUBLICADO",
  motivo: string,
  patch: Partial<typeof fallos.$inferInsert>,
) {
  const db = getDb();
  const current = await db.query.fallos.findFirst({
    where: and(eq(fallos.id, id), eq(fallos.tenantId, ctx.user.tenantId)),
  });
  if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Fallo no encontrado." });
  assertFalloTransition(current.estado as FalloEstado, next);

  const decisions = await db.select().from(falloLotDecisions).where(and(
    eq(falloLotDecisions.tenantId, ctx.user.tenantId),
    eq(falloLotDecisions.falloId, id),
  ));
  if (!decisions.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El fallo no contiene decisiones por lote." });

  if (next === "PUBLICADO") {
    const [offers, props, blockingAlerts] = await Promise.all([
      db.select({ id: participaciones.id, estadoEvaluacion: participaciones.estadoEvaluacion })
        .from(participaciones)
        .where(and(eq(participaciones.tenantId, ctx.user.tenantId), eq(participaciones.licitacionId, current.licitacionId))),
      db.select({ id: proposiciones.id, estado: proposiciones.estado })
        .from(proposiciones)
        .where(and(eq(proposiciones.tenantId, ctx.user.tenantId), eq(proposiciones.licitacionId, current.licitacionId))),
      db.query.alertasSeguridad.findMany({
        where: and(
          eq(alertasSeguridad.tenantId, ctx.user.tenantId),
          eq(alertasSeguridad.licitacionId, current.licitacionId),
          sql`${alertasSeguridad.severidad} IN ('ALTA','CRITICA')`,
          sql`${alertasSeguridad.estado} IN ('NUEVA','INVESTIGANDO','CONFIRMADA')`,
        ),
      }),
    ]);
    assertEvaluacionesCompletas(offers);
    if (props.length) assertProposicionesListasParaDictamen(props);
    if (blockingAlerts.some((alert) => alert.severidad === "CRITICA" || alert.estado === "CONFIRMADA")) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El fallo está bloqueado por alertas de riesgo sin resolver." });
    }
    for (const decision of decisions) {
      if (decision.outcome === "ADJUDICAR" && decision.proveedorId) {
        await assertProveedorPuedeAdjudicarse(ctx.user.tenantId, decision.proveedorId);
      }
    }
  }

  await db.transaction(async (tx) => {
    const result = await tx.update(fallos).set({ ...patch, estado: next }).where(and(
      eq(fallos.id, id),
      eq(fallos.tenantId, ctx.user.tenantId),
      eq(fallos.estado, current.estado),
    ));
    if (Number(result[0]?.affectedRows ?? 0) !== 1) {
      throw new TRPCError({ code: "CONFLICT", message: "El fallo cambió de estado." });
    }

    if (next === "APROBADO") {
      const awardCount = decisions.filter((decision) => decision.outcome === "ADJUDICAR").length;
      const awardUpdate = await tx.update(awards).set({ status: "APPROVED", approvedBy: ctx.user.id, approvedAt: new Date() }).where(and(
        eq(awards.tenantId, ctx.user.tenantId),
        eq(awards.falloId, id),
        eq(awards.status, "DRAFT"),
      ));
      if (Number(awardUpdate[0]?.affectedRows ?? 0) !== awardCount) {
        throw new TRPCError({ code: "CONFLICT", message: "Las adjudicaciones del fallo no estaban íntegras en estado DRAFT." });
      }
    }

    if (next === "PUBLICADO") {
      const publishedAt = new Date();
      const awardCount = decisions.filter((decision) => decision.outcome === "ADJUDICAR").length;
      const awardUpdate = await tx.update(awards).set({ status: "PUBLISHED", publishedAt }).where(and(
        eq(awards.tenantId, ctx.user.tenantId),
        eq(awards.falloId, id),
        eq(awards.status, "APPROVED"),
      ));
      if (Number(awardUpdate[0]?.affectedRows ?? 0) !== awardCount) {
        throw new TRPCError({ code: "CONFLICT", message: "Las adjudicaciones del fallo no estaban íntegras en estado APPROVED." });
      }
      for (const decision of decisions) {
        await tx.update(procedureLots).set({
          status: decision.outcome === "ADJUDICAR" ? "AWARDED" : "CLOSED",
        }).where(and(eq(procedureLots.tenantId, ctx.user.tenantId), eq(procedureLots.id, decision.lotId)));
        if (decision.outcome === "ADJUDICAR" && decision.participacionId) {
          await tx.update(participaciones).set({
            estadoEvaluacion: "GANADORA",
            montoAdjudicadoFinal: decision.amount,
          }).where(and(
            eq(participaciones.tenantId, ctx.user.tenantId),
            eq(participaciones.id, decision.participacionId),
            eq(participaciones.lotId, decision.lotId),
          ));
          await tx.update(proposiciones).set({ estado: "GANADORA" }).where(and(
            eq(proposiciones.tenantId, ctx.user.tenantId),
            eq(proposiciones.participacionId, decision.participacionId),
          ));
        }
      }

      const hasAwards = decisions.some((decision) => decision.outcome === "ADJUDICAR");
      const aggregateState = hasAwards
        ? "ADJUDICADA"
        : decisions.every((decision) => decision.outcome === "DESIERTO")
          ? "DESIERTA"
          : decisions.every((decision) => decision.outcome === "CANCELAR")
            ? "CANCELADA"
            : "FINALIZADA";
      await tx.update(licitaciones).set({
        estado: aggregateState,
        etapa: hasAwards ? "ADJUDICACION" : "FALLO",
        proveedorGanadorId: null,
        montoAdjudicado: null,
        fechaAdjudicacion: hasAwards ? publishedAt : null,
      }).where(and(eq(licitaciones.id, current.licitacionId), eq(licitaciones.tenantId, ctx.user.tenantId)));

      const awardRows = await tx.select().from(awards).where(and(
        eq(awards.tenantId, ctx.user.tenantId),
        eq(awards.falloId, id),
      ));
      await recordPublicationRelease(tx, {
        tenantId: ctx.user.tenantId,
        licitacionId: current.licitacionId,
        eventType: "AWARD_PUBLISHED",
        sourceType: "fallos",
        sourceId: id,
        payload: { falloId: id, decisions, awards: awardRows },
        publishedBy: ctx.user.id,
      });
      await enqueueOutbox(tx, {
        tenantId: ctx.user.tenantId,
        aggregateType: "fallos",
        aggregateId: id,
        eventType: "FALLO_PUBLICADO",
        payload: {
          falloId: id,
          licitacionId: current.licitacionId,
          decisions,
          awards: awardRows,
          actorUserId: ctx.user.id,
          asunto: `Fallo por lotes publicado #${id}`,
          cuerpo: motivo,
          entidadRef: "fallos",
          entidadId: id,
        },
      });
    }

    await appendExpedienteEvent(tx, ctx, {
      expedienteId: current.expedienteId,
      tipo: `FALLO_${next}`,
      estadoAnterior: current.estado,
      estadoNuevo: next,
      motivo,
      payload: { falloId: id, decisions },
    });
    await writeAudit({
      ctx: ctxForAudit(ctx),
      accion: "TRANSICION",
      entidad: "fallos",
      entidadId: id,
      valorAnterior: current,
      valorNuevo: { ...current, ...patch, estado: next, decisions },
      motivo,
      tx,
    });
  });
  return falloBundle(ctx.user.tenantId, id);
}
