import { z } from "zod";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { createRouter, procedureMutation, adminQuery, proveedorQuery, ctxForAudit, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { participaciones, proveedores, licitacionReglasVersion, proposiciones, coiDeclaraciones, actosDesempate } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { assertLicitacionExists, validateRubric } from "../lib/domain";
import { assertPositiveDays, assertScore } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";
import { writeAudit } from "../lib/security";
import { detectLicitacionRisks } from "../lib/detection";
import { assertProveedorPuedeParticipar } from "../lib/sanciones-gate";
import { computeScoresAndOrden, parseDesempateOrden, type CriterioEvaluacion, type FrozenReglas } from "../lib/evaluation-engine";
import { mapEvalToProposicionEstado } from "../lib/proposicion";
import { parseTieBreakPolicy } from "../lib/procedure-policy";
import { assertRecepcionDentroDeVentana } from "../lib/calendario-gates";
import {
  loadAperturaEstado,
  redactParticipacionEconomica,
  insertSobreEconomico,
  hydrateOwnerMontoIfSealed,
  loadSobreForParticipacion,
  isLegacyPlaintextCandidate,
  ENVELOPE_PLACEHOLDER_MONTO,
} from "../lib/sobre-economico";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";
import { licitacionIdFromParticipacion } from "../lib/procedure-resolvers";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Importe inválido.");

async function ensureProviderForUser(tenantId: number, userId: number) {
  const db = getDb();
  const provider = await db.query.proveedores.findFirst({ where: and(eq(proveedores.tenantId, tenantId), eq(proveedores.usuarioId, userId), eq(proveedores.activo, true)) });
  if (!provider) throw new TRPCError({ code: "FORBIDDEN", message: "El usuario proveedor no tiene un expediente de proveedor activo asociado." });
  return provider;
}

async function redactList(
  items: any[],
  ctx: { user: { tenantId: number; role: string; id: number } },
  viewerProveedorId: number | null,
) {
  const byLic = new Map<number, string | null>();
  const db = getDb();
  const out = [];
  for (const item of items) {
    const licId = Number(item.licitacionId);
    if (!byLic.has(licId)) byLic.set(licId, await loadAperturaEstado(ctx.user.tenantId, licId));
    const aperturaEstado = byLic.get(licId);
    const isOwner =
      ctx.user.role === "proveedor" &&
      viewerProveedorId != null &&
      Number(viewerProveedorId) === Number(item.proveedorId);
    const sobre = await loadSobreForParticipacion(db, ctx.user.tenantId, Number(item.id));
    const legacyPlaintext = isLegacyPlaintextCandidate({
      montoOferta: item.montoOferta,
      hasSobreEconomico: !!sobre,
    });
    let hydrated = await hydrateOwnerMontoIfSealed(item, {
      tenantId: ctx.user.tenantId,
      isOwner,
      revelado: !!aperturaEstado && ["ABIERTA","REGISTRADA","ACTA_EMITIDA","PUBLICADA"].includes(aperturaEstado),
    });
    out.push(
      redactParticipacionEconomica(hydrated, {
        role: ctx.user.role,
        viewerProveedorId,
        itemProveedorId: item.proveedorId,
        aperturaEstado,
        legacyPlaintext,
      }),
    );
  }
  return out;
}

export const participacionesRouter = createRouter({
  list: authedQuery.input(z.object({ licitacionId: z.number().int().positive().optional(), proveedorId: z.number().int().positive().optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(participaciones.tenantId, ctx.user.tenantId)];
    let viewerProveedorId: number | null = null;
    if (ctx.user.role === "proveedor") {
      const provider = await ensureProviderForUser(ctx.user.tenantId, ctx.user.id);
      viewerProveedorId = provider.id;
      conditions.push(eq(participaciones.proveedorId, provider.id));
    } else if (input?.proveedorId) conditions.push(eq(participaciones.proveedorId, input.proveedorId));
    if (input?.licitacionId) conditions.push(eq(participaciones.licitacionId, input.licitacionId));
    const where = and(...conditions); const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.participaciones.findMany({ where, orderBy: [desc(participaciones.createdAt)], limit: pageSize, offset, with: { proveedor: true, licitacion: true, evaluator: true } }),
      db.select({ total: count() }).from(participaciones).where(where),
    ]);
    const redacted = await redactList(items as any[], ctx, viewerProveedorId);
    return pageResult(redacted, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  getById: authedQuery.input(z.object({ id: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const db = getDb();
    const item = await db.query.participaciones.findFirst({ where: and(eq(participaciones.id, input.id), eq(participaciones.tenantId, ctx.user.tenantId)), with: { proveedor: true, licitacion: true, evaluator: true } });
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Oferta no encontrada." });
    let viewerProveedorId: number | null = null;
    if (ctx.user.role === "proveedor") {
      if (item.proveedor?.usuarioId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "No puede consultar una oferta de otro proveedor." });
      viewerProveedorId = item.proveedorId;
    }
    const aperturaEstado = await loadAperturaEstado(ctx.user.tenantId, item.licitacionId);
    const isOwner = viewerProveedorId != null && Number(viewerProveedorId) === Number(item.proveedorId);
    const sobre = await loadSobreForParticipacion(db, ctx.user.tenantId, item.id);
    const legacyPlaintext = isLegacyPlaintextCandidate({
      montoOferta: item.montoOferta,
      hasSobreEconomico: !!sobre,
    });
    const hydrated = await hydrateOwnerMontoIfSealed(item as any, {
      tenantId: ctx.user.tenantId,
      isOwner,
      revelado: !!aperturaEstado && ["ABIERTA","REGISTRADA","ACTA_EMITIDA","PUBLICADA"].includes(aperturaEstado),
    });
    return redactParticipacionEconomica(hydrated, {
      role: ctx.user.role,
      viewerProveedorId,
      itemProveedorId: item.proveedorId,
      aperturaEstado,
      legacyPlaintext,
    });
  }),

  create: proveedorQuery.input(z.object({ licitacionId: z.number().int().positive(), montoOferta: money, plazoEjecucion: z.number().int().positive(), observaciones: z.string().trim().optional() })).mutation(async ({ input, ctx }) => {
    const provider = await ensureProviderForUser(ctx.user.tenantId, ctx.user.id);
    await assertProveedorPuedeParticipar(ctx.user.tenantId, provider.id);
    const db = getDb(); const lic = await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    if (ctx.user.role === "proveedor" && lic.estado !== "PUBLICADA") throw new TRPCError({ code: "CONFLICT", message: "Las ofertas sólo pueden presentarse en licitaciones publicadas." });
    // Canonical reception: calendario RECEPCION ventana_* only (never fechaCierre day clock).
    await assertRecepcionDentroDeVentana(ctx.user.tenantId, input.licitacionId);
    if (Number(input.montoOferta) <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "La oferta debe ser mayor que cero." });
    assertPositiveDays(input.plazoEjecucion, "plazoEjecucion");
    const dup = await db.query.participaciones.findFirst({ where: and(eq(participaciones.tenantId, ctx.user.tenantId), eq(participaciones.licitacionId, input.licitacionId), eq(participaciones.proveedorId, provider.id)) });
    if (dup) throw new TRPCError({ code: "CONFLICT", message: "El proveedor ya presentó una oferta en esta licitación." });
    const recibidoAt = new Date();
    let id = 0;
    let created: any = null;
    await db.transaction(async (tx) => {
      const result = await tx.insert(participaciones).values({
        tenantId: ctx.user.tenantId, licitacionId: input.licitacionId, proveedorId: provider.id,
        // Placeholder until apertura reveal — plaintext lives only in sobres_economicos ciphertext.
        montoOferta: ENVELOPE_PLACEHOLDER_MONTO, monedaOferta: "MXN", plazoEjecucion: input.plazoEjecucion,
        estadoEvaluacion: "PENDIENTE", observaciones: input.observaciones ?? null, recibidoAt,
      } as any);
      id = Number(result[0].insertId);
      const propIns = await tx.insert(proposiciones).values({
        tenantId: ctx.user.tenantId, licitacionId: input.licitacionId, proveedorId: provider.id,
        participacionId: id, estado: "RECIBIDA", montoOferta: ENVELOPE_PLACEHOLDER_MONTO, recibidoAt,
      } as any);
      const proposicionId = Number(propIns[0].insertId);
      await insertSobreEconomico(tx, {
        tenantId: ctx.user.tenantId,
        licitacionId: input.licitacionId,
        participacionId: id,
        proposicionId,
        monto: input.montoOferta,
      });
      await tx.update(proveedores).set({
        licitacionesParticipadas: sql`${proveedores.licitacionesParticipadas} + 1`,
      } as any).where(and(eq(proveedores.id, provider.id), eq(proveedores.tenantId, ctx.user.tenantId)));
      created = (await tx.query.participaciones.findFirst({ where: and(eq(participaciones.id, id), eq(participaciones.tenantId, ctx.user.tenantId)) })) as any;
      await writeAudit({
        ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "participaciones", entidadId: id,
        valorNuevo: { ...created, montoOferta: "[SELLADO]" },
        tx,
      });
    });
    await detectLicitacionRisks(ctx.user.tenantId, input.licitacionId);
    // Owner response includes submitted monto (never persisted plaintext pre-apertura).
    return { ...created, montoOferta: input.montoOferta, sobreEconomicoSellado: true };
  }),

  evaluar: procedureMutation({
    capability: ["evaluar_tecnico", "evaluar_economico"],
    roles: ["evaluador_tecnico", "evaluador_economico"],
    resolveLicitacionId: (i, ctx) => licitacionIdFromParticipacion(i, ctx.user!.tenantId),
  }).input(z.object({
    id: z.number().int().positive(),
    puntajeTecnico: z.number().min(0).max(100).optional(),
    criteriosTecnicos: z.record(z.string().trim().min(1), z.number().min(0).max(100)).optional(),
    estadoEvaluacion: z.enum(["ADMISIBLE","NO_ADMISIBLE","RECHAZADA"]),
    observaciones: z.string().trim().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const offer = await db.query.participaciones.findFirst({
      where: and(eq(participaciones.id, input.id), eq(participaciones.tenantId, ctx.user.tenantId)),
      with: { licitacion: true },
    });
    if (!offer) throw new TRPCError({ code: "NOT_FOUND", message: "Oferta no encontrada." });
    const lic = offer.licitacion;
    if (lic.estado !== "EN_EVALUACION") throw new TRPCError({ code: "CONFLICT", message: "La licitación debe estar EN_EVALUACION." });

    // Assignment enforced by procedureMutation (evaluador_tecnico | evaluador_economico).
    const coi = await db.query.coiDeclaraciones.findFirst({
      where: and(eq(coiDeclaraciones.tenantId, ctx.user.tenantId), eq(coiDeclaraciones.licitacionId, lic.id), eq(coiDeclaraciones.userId, ctx.user.id), eq(coiDeclaraciones.tieneConflicto, true), eq(coiDeclaraciones.recusado, false)),
    });
    if (coi) throw new TRPCError({ code: "FORBIDDEN", message: "Conflicto de interés declarado sin recusación: no puede evaluar." });

    const frozenRow = await db.query.licitacionReglasVersion.findFirst({
      where: and(eq(licitacionReglasVersion.tenantId, ctx.user.tenantId), eq(licitacionReglasVersion.licitacionId, lic.id)),
      orderBy: [desc(licitacionReglasVersion.version)],
    });
    if (!frozenRow) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No hay reglas de evaluación congeladas; publique el procedimiento primero." });
    const frozen: FrozenReglas = {
      criterioEvaluacion: frozenRow.criterioEvaluacion as CriterioEvaluacion,
      ponderacionTecnica: frozenRow.ponderacionTecnica,
      ponderacionEconomica: frozenRow.ponderacionEconomica,
      modoEvaluacion: frozenRow.modoEvaluacion,
      tipoLicitacion: frozenRow.tipoLicitacion,
      tipoContratacion: frozenRow.tipoContratacion,
      marcoJuridico: frozenRow.marcoJuridico,
      rubricaTecnica: frozenRow.rubricaTecnica ?? null,
    };

    let technical: number | null = null;
    let criteriaJson: string | null = null;
    if (input.estadoEvaluacion === "ADMISIBLE") {
      const rubric = validateRubric(frozen.rubricaTecnica);
      if (frozen.modoEvaluacion === "AUTOMATICA" && !input.criteriosTecnicos) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Esta licitación exige evaluación técnica por rúbrica." });
      }
      if (frozen.modoEvaluacion === "MANUAL" && input.criteriosTecnicos) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Esta licitación exige captura manual del puntaje técnico." });
      }
      if (input.criteriosTecnicos) {
        if (!rubric) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Se requiere una rúbrica técnica configurada." });
        const codes = new Set(rubric.map(x => x.codigo));
        const inputCodes = Object.keys(input.criteriosTecnicos);
        if (inputCodes.length !== rubric.length || inputCodes.some(code => !codes.has(code))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Debe evaluarse exactamente cada criterio definido en la rúbrica." });
        }
        technical = Number(rubric.reduce((sum, r) => sum + Number(input.criteriosTecnicos?.[r.codigo]) * (Number(r.peso) / 100), 0).toFixed(2));
        criteriaJson = JSON.stringify(input.criteriosTecnicos);
      } else if (input.puntajeTecnico != null) {
        technical = Number(input.puntajeTecnico.toFixed(2));
      } else {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Debe proporcionar puntaje técnico o criterios técnicos." });
      }
      assertScore(technical, "puntajeTecnico");
    }

    const current = offer;
    const desempate = await db.query.actosDesempate.findFirst({
      where: and(
        eq(actosDesempate.tenantId, ctx.user.tenantId),
        eq(actosDesempate.licitacionId, lic.id),
        eq(actosDesempate.estado, "REGISTRADO"),
      ),
    });
    const desempateMap = parseDesempateOrden(desempate?.resultadoJson);

    let updated: any = null;
    await db.transaction(async (tx) => {
      await tx.select({ id: participaciones.id })
        .from(participaciones)
        .where(and(eq(participaciones.tenantId, ctx.user.tenantId), eq(participaciones.licitacionId, lic.id)))
        .for("update");

      await tx.update(participaciones).set({
        estadoEvaluacion: input.estadoEvaluacion,
        puntajeTecnico: technical == null ? null : technical.toFixed(2),
        puntajeEconomico: null,
        puntajeTotal: null,
        ordenMerito: null,
        criteriosTecnicos: criteriaJson,
        evaluatedBy: ctx.user.id,
        evaluatedAt: new Date(),
        observaciones: input.observaciones ?? null,
      }).where(and(eq(participaciones.id, input.id), eq(participaciones.tenantId, ctx.user.tenantId)));

      const admissible = await tx.select({
        id: participaciones.id, montoOferta: participaciones.montoOferta, puntajeTecnico: participaciones.puntajeTecnico,
        recibidoAt: participaciones.recibidoAt,
      }).from(participaciones)
        .where(and(eq(participaciones.tenantId, ctx.user.tenantId), eq(participaciones.licitacionId, lic.id), eq(participaciones.estadoEvaluacion, "ADMISIBLE")));

      const forRank = admissible.map((c) => ({
        id: c.id,
        montoOferta: c.montoOferta,
        puntajeTecnico: c.id === input.id ? technical : c.puntajeTecnico,
        recibidoAt: c.recibidoAt,
        desempateOrden: desempateMap.get(c.id) ?? null,
      }));

      const tb = parseTieBreakPolicy((frozenRow as any).tieBreakPolicy);
      const patches = computeScoresAndOrden(frozen, forRank, tb);
      for (const patch of patches) {
        assertScore(Number(patch.puntajeEconomico), "puntajeEconomico");
        assertScore(Number(patch.puntajeTotal), "puntajeTotal");
        await tx.update(participaciones).set({
          puntajeEconomico: patch.puntajeEconomico,
          puntajeTotal: patch.puntajeTotal,
          ordenMerito: patch.ordenMerito,
        }).where(and(eq(participaciones.id, patch.id), eq(participaciones.tenantId, ctx.user.tenantId)));
      }
      const propEstado = mapEvalToProposicionEstado(input.estadoEvaluacion);
      if (propEstado) {
        await tx.update(proposiciones).set({ estado: propEstado } as any)
          .where(and(eq(proposiciones.tenantId, ctx.user.tenantId), eq(proposiciones.participacionId, input.id)));
      }
      updated = await tx.query.participaciones.findFirst({ where: and(eq(participaciones.id, input.id), eq(participaciones.tenantId, ctx.user.tenantId)) });
      await writeAudit({
        ctx: ctxForAudit(ctx), accion: "EVALUAR", entidad: "participaciones", entidadId: input.id,
        valorAnterior: current, valorNuevo: updated, motivo: input.motivo, tx,
      });
    });

    return updated;
  }),

  /** Soft-delete only — hard delete disabled. Marks RETIRADA/INVALIDADA + expediente event. */
  delete: adminQuery.input(z.object({
    id: z.number().int().positive(),
    motivo: z.string().trim().min(3),
    estado: z.enum(["RETIRADA", "INVALIDADA"]).default("INVALIDADA"),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const current = await db.query.participaciones.findFirst({
      where: and(eq(participaciones.id, input.id), eq(participaciones.tenantId, ctx.user.tenantId)),
    });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Oferta no encontrada." });
    if (["GANADORA", "ADMISIBLE"].includes(current.estadoEvaluacion)) {
      throw new TRPCError({ code: "CONFLICT", message: "Una oferta admisible/adjudicada no se retira por esta vía." });
    }
    if (["RETIRADA", "INVALIDADA"].includes(current.estadoEvaluacion)) {
      throw new TRPCError({ code: "CONFLICT", message: "La oferta ya está retirada o invalidada." });
    }
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, current.licitacionId);
    await db.transaction(async (tx) => {
      await tx.update(participaciones).set({ estadoEvaluacion: input.estado } as any)
        .where(and(eq(participaciones.id, input.id), eq(participaciones.tenantId, ctx.user.tenantId)));
      await tx.update(proposiciones).set({ estado: "DESECHADA" } as any)
        .where(and(eq(proposiciones.tenantId, ctx.user.tenantId), eq(proposiciones.participacionId, input.id)));
      if (expediente) {
        await appendExpedienteEvent(tx, ctx, {
          expedienteId: expediente.id,
          tipo: input.estado === "RETIRADA" ? "PARTICIPACION_RETIRADA" : "PARTICIPACION_INVALIDADA",
          estadoAnterior: current.estadoEvaluacion,
          estadoNuevo: input.estado,
          motivo: input.motivo,
          payload: { participacionId: input.id },
        });
      }
      await writeAudit({
        ctx: ctxForAudit(ctx), accion: input.estado, entidad: "participaciones", entidadId: input.id,
        valorAnterior: current, motivo: input.motivo, tx,
      });
    });
    return { success: true, estado: input.estado };
  }),
});
