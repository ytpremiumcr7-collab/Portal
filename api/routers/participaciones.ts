import { z } from "zod";
import { eq, desc, and, count, sql, inArray } from "drizzle-orm";
import { createRouter, procedureMutation, adminQuery, proveedorQuery, ctxForAudit, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { participaciones, proveedores, licitacionReglasVersion, proposiciones, proposicionDocumentos, documentos, coiDeclaraciones, actosDesempate, consorcios, consorcioMiembros } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { assertLicitacionExists, validateRubric } from "../lib/domain";
import { assertPositiveDays, assertScore } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";
import { writeAudit } from "../lib/security";
import { detectLicitacionRisks } from "../lib/detection";
import { assertProveedorPuedeParticipar } from "../lib/sanciones-gate";
import { computeScoresAndOrden, parseDesempateOrden, type CriterioEvaluacion, type FrozenReglas } from "../lib/evaluation-engine";
import { mapEvalToProposicionEstado, buildProposicionManifest, mapDocTipoToRol, assertProposicionDocsCompletos } from "../lib/proposicion";
import { parseTieBreakPolicy, parseRequisitos, assertTransitionAllowed, mergeModalidadRequisitos } from "../lib/procedure-policy";
import { assertRecepcionDentroDeVentana, assertRetiroProposicionPermitido } from "../lib/calendario-gates";
import {
  loadAperturaEstado,
  redactParticipacionEconomica,
  insertSobreEconomico,
  hydrateOwnerMontoIfSealed,
  loadSobreForParticipacion,
  isLegacyPlaintextCandidate,
  ENVELOPE_PLACEHOLDER_MONTO,
} from "../lib/sobre-economico";
import { ciphertextHash } from "../lib/envelope-crypto";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";
import { licitacionIdFromParticipacion } from "../lib/procedure-resolvers";
import { moneyGt } from "../lib/money";
import { procedureLots, submissionReceipts } from "@db/schema-eproc";
import { resolveSupplierActor, resolveSupplierActorInTx, supplierProviderIdsForUser } from "../lib/supplier-authority";
import { createSubmissionReceipt } from "../lib/submission-receipt";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Importe inválido.");

async function redactList(
  items: any[],
  ctx: { user: { tenantId: number; role: string; id: number } },
  viewerProveedorIds: ReadonlySet<number>,
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
      viewerProveedorIds.has(Number(item.proveedorId));
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
        viewerProveedorId: isOwner ? Number(item.proveedorId) : null,
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
    let viewerProveedorIds = new Set<number>();
    if (ctx.user.role === "proveedor") {
      const ids = await supplierProviderIdsForUser(ctx.user.tenantId, ctx.user.id);
      viewerProveedorIds = new Set(ids);
      if (!ids.length) return pageResult([], 0, page, pageSize);
      conditions.push(inArray(participaciones.proveedorId, ids));
    } else if (input?.proveedorId) conditions.push(eq(participaciones.proveedorId, input.proveedorId));
    if (input?.licitacionId) conditions.push(eq(participaciones.licitacionId, input.licitacionId));
    const where = and(...conditions); const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.participaciones.findMany({ where, orderBy: [desc(participaciones.createdAt)], limit: pageSize, offset, with: { proveedor: true, licitacion: true, evaluator: true } }),
      db.select({ total: count() }).from(participaciones).where(where),
    ]);
    const redacted = await redactList(items as any[], ctx, viewerProveedorIds);
    return pageResult(redacted, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  getById: authedQuery.input(z.object({ id: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const db = getDb();
    const item = await db.query.participaciones.findFirst({ where: and(eq(participaciones.id, input.id), eq(participaciones.tenantId, ctx.user.tenantId)), with: { proveedor: true, licitacion: true, evaluator: true } });
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Oferta no encontrada." });
    let viewerProveedorId: number | null = null;
    if (ctx.user.role === "proveedor") {
      const ids = await supplierProviderIdsForUser(ctx.user.tenantId, ctx.user.id);
      if (!ids.includes(item.proveedorId)) throw new TRPCError({ code: "FORBIDDEN", message: "No representa a la organización que presentó esta oferta." });
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

  submissionContext: proveedorQuery.input(z.object({
    licitacionId: z.number().int().positive(),
  })).query(async ({ input, ctx }) => {
    const db = getDb();
    const ids = await supplierProviderIdsForUser(ctx.user.tenantId, ctx.user.id);
    const [representations, lots] = await Promise.all([
      ids.length
        ? db.query.proveedores.findMany({
            where: and(eq(proveedores.tenantId, ctx.user.tenantId), inArray(proveedores.id, ids), eq(proveedores.activo, true)),
          })
        : Promise.resolve([]),
      db.query.procedureLots.findMany({
        where: and(
          eq(procedureLots.tenantId, ctx.user.tenantId),
          eq(procedureLots.licitacionId, input.licitacionId),
          eq(procedureLots.status, "ACTIVE"),
        ),
        orderBy: [procedureLots.id],
      }),
    ]);
    return { representations, lots };
  }),

  create: proveedorQuery.input(z.object({
    licitacionId: z.number().int().positive(),
    proveedorId: z.number().int().positive(),
    lotId: z.number().int().positive(),
    montoOferta: money,
    plazoEjecucion: z.number().int().positive(),
    observaciones: z.string().trim().optional(),
    documentoIds: z.array(z.number().int().positive()).min(2),
    /** Optional: ACTIVO consorcio must be linked BEFORE present; frozen into proposición + manifest. */
    consorcioId: z.number().int().positive().optional(),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const lot = await db.query.procedureLots.findFirst({
      where: and(
        eq(procedureLots.tenantId, ctx.user.tenantId),
        eq(procedureLots.id, input.lotId),
        eq(procedureLots.licitacionId, input.licitacionId),
        eq(procedureLots.status, "ACTIVE"),
      ),
    });
    if (!lot) throw new TRPCError({ code: "BAD_REQUEST", message: "El lote no existe, no está activo o pertenece a otro procedimiento." });
    const actorPreview = await resolveSupplierActor({
      tenantId: ctx.user.tenantId, actorUserId: ctx.user.id, proveedorId: input.proveedorId,
      procedureId: input.licitacionId, lotId: input.lotId, action: "SUBMIT",
    });
    const provider = actorPreview.provider;
    await assertProveedorPuedeParticipar(ctx.user.tenantId, provider.id);
    const lic = await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    if (ctx.user.role === "proveedor" && lic.estado !== "PUBLICADA") throw new TRPCError({ code: "CONFLICT", message: "Las ofertas sólo pueden presentarse en licitaciones publicadas." });
    const frozenPresent = await db.query.licitacionReglasVersion.findFirst({
      where: and(eq(licitacionReglasVersion.tenantId, ctx.user.tenantId), eq(licitacionReglasVersion.licitacionId, input.licitacionId)),
      orderBy: [desc(licitacionReglasVersion.version)],
    });
    assertTransitionAllowed(
      lic.tipoLicitacion as any,
      "PRESENTACION_LP",
      mergeModalidadRequisitos((frozenPresent as any)?.requisitos, (lic as any).modalidadMeta),
    );
    // Money gate before TX (format already zod-validated); reception window asserted INSIDE TX at commit instant.
    if (!moneyGt(input.montoOferta, 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "La oferta debe ser mayor que cero." });
    assertPositiveDays(input.plazoEjecucion, "plazoEjecucion");
    const dup = await db.query.participaciones.findFirst({
      where: and(
        eq(participaciones.tenantId, ctx.user.tenantId),
        eq(participaciones.licitacionId, input.licitacionId),
        eq(participaciones.lotId, input.lotId),
        eq(participaciones.proveedorId, provider.id),
      ),
    });
    if (dup) throw new TRPCError({ code: "CONFLICT", message: "La organización ya presentó una proposición en este lote." });

    const uniqueDocIds = [...new Set(input.documentoIds)];
    const docs = await db.query.documentos.findMany({
      where: and(eq(documentos.tenantId, ctx.user.tenantId), inArray(documentos.id, uniqueDocIds)),
    });
    if (docs.length !== uniqueDocIds.length) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Uno o más documentoIds no existen o no pertenecen al tenant." });
    }
    const ALLOWED_DOC_ESTADOS = new Set(["APROBADO", "PENDIENTE", "VALIDANDO"]);
    for (const d of docs) {
      if (d.proveedorId !== provider.id) throw new TRPCError({ code: "FORBIDDEN", message: `Documento #${d.id} no pertenece al proveedor.` });
      if (d.licitacionId !== input.licitacionId) throw new TRPCError({ code: "BAD_REQUEST", message: `Documento #${d.id} no pertenece a esta licitación.` });
      if (!d.esVersionVigente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Documento #${d.id} no es versión vigente.` });
      if (!ALLOWED_DOC_ESTADOS.has(d.estado)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Documento #${d.id} en estado no permitido (${d.estado}).` });
    }
    const propDocs = docs.map((d) => {
      const rol = mapDocTipoToRol(d.tipo);
      if (!rol) throw new TRPCError({ code: "BAD_REQUEST", message: `Documento #${d.id} tipo ${d.tipo} no es rol de proposición.` });
      return { documentoId: d.id, rol, sha256: d.sha256 };
    });
    const frozen = await db.query.licitacionReglasVersion.findFirst({
      where: and(eq(licitacionReglasVersion.tenantId, ctx.user.tenantId), eq(licitacionReglasVersion.licitacionId, input.licitacionId)),
      orderBy: [desc(licitacionReglasVersion.version)],
    });
    const requisitos = parseRequisitos(frozen?.requisitos);
    assertProposicionDocsCompletos(propDocs, requisitos);

    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin expediente electrónico." });

    let id = 0;
    let created: any = null;
    let manifestHashOut = "";
    let receiptOut: any = null;
    let recibidoAt = new Date();
    await db.transaction(async (tx) => {
      // Same-instant reception: lock calendar, stamp recibidoAt, assert ventana with THAT instant.
      recibidoAt = new Date();
      await assertRecepcionDentroDeVentana(ctx.user.tenantId, input.licitacionId, {
        at: recibidoAt,
        tx,
        lock: true,
      });
      const actor = await resolveSupplierActorInTx(tx, {
        tenantId: ctx.user.tenantId, actorUserId: ctx.user.id, proveedorId: input.proveedorId,
        procedureId: input.licitacionId, lotId: input.lotId, action: "SUBMIT",
      });

      let consorcioId: number | null = input.consorcioId ?? null;
      let miembrosForManifest: Array<{ proveedorId: number; rol: string; porcentajeParticipacion: string | null }> = [];
      if (consorcioId != null) {
        const cons = await tx.query.consorcios.findFirst({
          where: and(eq(consorcios.id, consorcioId), eq(consorcios.tenantId, ctx.user.tenantId)),
        });
        if (!cons || cons.estado !== "ACTIVO") {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sólo un consorcio ACTIVO puede presentarse; vincular/congelar antes de presentar." });
        }
        const miembros = await tx.query.consorcioMiembros.findMany({
          where: and(eq(consorcioMiembros.tenantId, ctx.user.tenantId), eq(consorcioMiembros.consorcioId, consorcioId)),
        });
        if (!miembros.some((m) => Number(m.proveedorId) === Number(provider.id))) {
          throw new TRPCError({ code: "FORBIDDEN", message: "El proveedor presentante debe ser miembro del consorcio." });
        }
        miembrosForManifest = miembros.map((m) => ({
          proveedorId: m.proveedorId,
          rol: m.rol,
          porcentajeParticipacion: m.porcentajeParticipacion != null ? String(m.porcentajeParticipacion) : null,
        }));
        // Freeze consorcio identity at present.
        await tx.update(consorcios).set({ estado: "CONGELADO" } as any)
          .where(and(eq(consorcios.id, consorcioId), eq(consorcios.tenantId, ctx.user.tenantId), eq(consorcios.estado, "ACTIVO")));
      }

      const result = await tx.insert(participaciones).values({
        tenantId: ctx.user.tenantId, licitacionId: input.licitacionId, lotId: input.lotId, proveedorId: provider.id,
        montoOferta: ENVELOPE_PLACEHOLDER_MONTO, monedaOferta: "MXN", plazoEjecucion: input.plazoEjecucion,
        estadoEvaluacion: "PENDIENTE", observaciones: input.observaciones ?? null, recibidoAt,
        consorcioId,
      } as any);
      id = Number(result[0].insertId);
      const propIns = await tx.insert(proposiciones).values({
        tenantId: ctx.user.tenantId, licitacionId: input.licitacionId, lotId: input.lotId, proveedorId: provider.id,
        participacionId: id, estado: "RECIBIDA", montoOferta: ENVELOPE_PLACEHOLDER_MONTO, recibidoAt,
        consorcioId,
      } as any);
      const proposicionId = Number(propIns[0].insertId);
      const seal = await insertSobreEconomico(tx, {
        tenantId: ctx.user.tenantId,
        licitacionId: input.licitacionId,
        participacionId: id,
        proposicionId,
        monto: input.montoOferta,
      });
      const ctHash = ciphertextHash(seal.ciphertext);
      for (const d of propDocs) {
        await tx.insert(proposicionDocumentos).values({
          tenantId: ctx.user.tenantId,
          proposicionId,
          documentoId: d.documentoId,
          rol: d.rol,
          sha256: d.sha256,
        } as any);
      }
      const { manifestHash } = buildProposicionManifest({
        proposicionId,
        participacionId: id,
        proveedorId: provider.id,
        lotId: input.lotId,
        actorUserId: ctx.user.id,
        supplierMembershipId: actor.membership.id,
        actingAuthorityId: actor.authority.id,
        ciphertextHash: ctHash,
        recibidoAt,
        documentos: propDocs,
        consorcioId: consorcioId ?? undefined,
        consorcioMiembros: miembrosForManifest.length ? miembrosForManifest : undefined,
      });
      manifestHashOut = manifestHash;
      await tx.update(proposiciones).set({
        manifestHash, sealHash: manifestHash, sealedAt: recibidoAt, estado: "RECIBIDA",
      } as any).where(and(eq(proposiciones.id, proposicionId), eq(proposiciones.tenantId, ctx.user.tenantId)));
      receiptOut = await createSubmissionReceipt(tx, {
        tenantId: ctx.user.tenantId,
        licitacionId: input.licitacionId,
        lotId: input.lotId,
        participacionId: id,
        proposicionId,
        proveedorId: provider.id,
        supplierOrganizationId: actor.provider.legalEntityId,
        submittedByUserId: ctx.user.id,
        supplierMembershipId: actor.membership.id,
        actingAuthorityId: actor.authority.id,
        authoritySnapshot: actor.authoritySnapshot,
        receiptType: "SUBMISSION",
        manifestHash,
        sealHash: manifestHash,
        ciphertextHash: ctHash,
        submissionVersion: 1,
        serverReceivedAt: recibidoAt,
      });
      await tx.update(proveedores).set({
        licitacionesParticipadas: sql`${proveedores.licitacionesParticipadas} + 1`,
      } as any).where(and(eq(proveedores.id, provider.id), eq(proveedores.tenantId, ctx.user.tenantId)));
      created = (await tx.query.participaciones.findFirst({ where: and(eq(participaciones.id, id), eq(participaciones.tenantId, ctx.user.tenantId)) })) as any;
      await appendExpedienteEvent(tx, ctx, {
        expedienteId: expediente.id,
        tipo: "PROPOSICION_PRESENTADA",
        estadoAnterior: null,
        estadoNuevo: "RECIBIDA",
        motivo: "Presentación atómica de proposición con manifiesto documental",
        payload: {
          participacionId: id, proposicionId, proveedorId: provider.id, lotId: input.lotId,
          manifestHash, receiptCode: receiptOut.receiptCode, receiptHash: receiptOut.receiptHash,
          timestampStatus: receiptOut.timestampStatus, authority: actor.authoritySnapshot,
          documentoIds: uniqueDocIds,
        },
      });
      await writeAudit({
        ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "participaciones", entidadId: id,
        valorNuevo: {
          ...created, montoOferta: "[SELLADO]", manifestHash, proposicionId,
          receiptCode: receiptOut.receiptCode, receiptHash: receiptOut.receiptHash,
          authority: actor.authoritySnapshot,
        },
        tx,
      });
    });
    await detectLicitacionRisks(ctx.user.tenantId, input.licitacionId);
    return {
      ...created,
      montoOferta: input.montoOferta,
      sobreEconomicoSellado: true,
      manifestHash: manifestHashOut,
      receipt: receiptOut,
    };
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

  /** Proveedor retira su propia proposición (RETIRADA). Admin MUST use invalidar — not this path. */
  retirar: authedQuery.input(z.object({
    id: z.number().int().positive(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    if (ctx.user.role !== "proveedor") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sólo el proveedor titular puede retirar. La autoridad debe usar invalidar.",
      });
    }
    const db = getDb();
    const current = await db.query.participaciones.findFirst({
      where: and(eq(participaciones.id, input.id), eq(participaciones.tenantId, ctx.user.tenantId)),
      with: { proveedor: true },
    });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Oferta no encontrada." });
    if (current.lotId == null) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La proposición no tiene lote institucional vinculado." });
    }
    await resolveSupplierActor({
      tenantId: ctx.user.tenantId, actorUserId: ctx.user.id, proveedorId: current.proveedorId,
      procedureId: current.licitacionId, lotId: current.lotId, action: "WITHDRAW",
    });
    if (["GANADORA", "ADMISIBLE", "RETIRADA", "INVALIDADA"].includes(current.estadoEvaluacion)) {
      throw new TRPCError({ code: "CONFLICT", message: `No se puede retirar en estado ${current.estadoEvaluacion}.` });
    }
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, current.licitacionId);
    const aperturaEstado = await loadAperturaEstado(ctx.user.tenantId, current.licitacionId);
    let withdrawalReceipt: any = null;
    await db.transaction(async (tx) => {
      // TOCTOU: lock participation + calendar + supplier authority in the same transaction.
      const locked = await tx.select().from(participaciones)
        .where(and(eq(participaciones.id, input.id), eq(participaciones.tenantId, ctx.user.tenantId)))
        .for("update")
        .limit(1);
      const row = locked[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Oferta no encontrada." });
      if (["GANADORA", "ADMISIBLE", "RETIRADA", "INVALIDADA"].includes(row.estadoEvaluacion)) {
        throw new TRPCError({ code: "CONFLICT", message: `No se puede retirar en estado ${row.estadoEvaluacion}.` });
      }
      const actor = await resolveSupplierActorInTx(tx, {
        tenantId: ctx.user.tenantId, actorUserId: ctx.user.id, proveedorId: row.proveedorId,
        procedureId: row.licitacionId, lotId: row.lotId!, action: "WITHDRAW",
      });
      const now = new Date();
      await assertRetiroProposicionPermitido(ctx.user.tenantId, current.licitacionId, {
        at: now,
        tx,
        lock: true,
        aperturaEstado,
      });
      await tx.update(participaciones).set({ estadoEvaluacion: "RETIRADA" } as any)
        .where(and(eq(participaciones.id, input.id), eq(participaciones.tenantId, ctx.user.tenantId)));
      const prop = await tx.query.proposiciones.findFirst({
        where: and(eq(proposiciones.tenantId, ctx.user.tenantId), eq(proposiciones.participacionId, input.id)),
      });
      if (!prop?.manifestHash || !prop.sealHash) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La proposición no tiene manifiesto/sello verificable." });
      }
      const sobre = await loadSobreForParticipacion(tx, ctx.user.tenantId, row.id);
      if (!sobre?.ciphertext) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La proposición no tiene sobre económico sellado." });
      }
      const ctHash = ciphertextHash(sobre.ciphertext);
      await tx.update(proposiciones).set({ estado: "DESECHADA" } as any)
        .where(and(eq(proposiciones.tenantId, ctx.user.tenantId), eq(proposiciones.participacionId, input.id)));
      withdrawalReceipt = await createSubmissionReceipt(tx, {
        tenantId: ctx.user.tenantId,
        licitacionId: row.licitacionId,
        lotId: row.lotId!,
        participacionId: row.id,
        proposicionId: prop.id,
        proveedorId: row.proveedorId,
        supplierOrganizationId: actor.provider.legalEntityId,
        submittedByUserId: ctx.user.id,
        supplierMembershipId: actor.membership.id,
        actingAuthorityId: actor.authority.id,
        authoritySnapshot: actor.authoritySnapshot,
        receiptType: "WITHDRAWAL",
        manifestHash: prop.manifestHash,
        sealHash: prop.sealHash,
        ciphertextHash: ctHash,
        submissionVersion: 1,
        serverReceivedAt: now,
      });
      if (expediente) {
        await appendExpedienteEvent(tx, ctx, {
          expedienteId: expediente.id, tipo: "PARTICIPACION_RETIRADA",
          estadoAnterior: row.estadoEvaluacion, estadoNuevo: "RETIRADA", motivo: input.motivo,
          payload: {
            participacionId: input.id, proveedorId: row.proveedorId, lotId: row.lotId,
            actorUserId: ctx.user.id, authority: actor.authoritySnapshot,
            receiptCode: withdrawalReceipt.receiptCode, receiptHash: withdrawalReceipt.receiptHash,
            timestampStatus: withdrawalReceipt.timestampStatus, retiroAt: now.toISOString(),
          },
        });
      }
      await writeAudit({ ctx: ctxForAudit(ctx), accion: "RETIRAR", entidad: "participaciones", entidadId: input.id, valorAnterior: current, motivo: input.motivo, tx });
    });
    return { success: true, estado: "RETIRADA" as const, receipt: withdrawalReceipt };
  }),

  /** Autoridad de procedimiento invalida proposición (INVALIDADA) — distinto de retiro del proveedor. */
  invalidar: procedureMutation({
    capability: "crear_procedimiento",
    roles: ["creador"],
    resolveLicitacionId: (i, ctx) => licitacionIdFromParticipacion(i, ctx.user!.tenantId),
  }).input(z.object({
    id: z.number().int().positive(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const current = await db.query.participaciones.findFirst({
      where: and(eq(participaciones.id, input.id), eq(participaciones.tenantId, ctx.user.tenantId)),
    });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Oferta no encontrada." });
    if (["GANADORA", "RETIRADA", "INVALIDADA"].includes(current.estadoEvaluacion)) {
      throw new TRPCError({ code: "CONFLICT", message: `No se puede invalidar en estado ${current.estadoEvaluacion}.` });
    }
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, current.licitacionId);
    await db.transaction(async (tx) => {
      await tx.update(participaciones).set({ estadoEvaluacion: "INVALIDADA" } as any)
        .where(and(eq(participaciones.id, input.id), eq(participaciones.tenantId, ctx.user.tenantId)));
      await tx.update(proposiciones).set({ estado: "DESECHADA" } as any)
        .where(and(eq(proposiciones.tenantId, ctx.user.tenantId), eq(proposiciones.participacionId, input.id)));
      if (expediente) {
        await appendExpedienteEvent(tx, ctx, {
          expedienteId: expediente.id, tipo: "PARTICIPACION_INVALIDADA",
          estadoAnterior: current.estadoEvaluacion, estadoNuevo: "INVALIDADA", motivo: input.motivo,
          payload: { participacionId: input.id, actor: "autoridad" },
        });
      }
      await writeAudit({ ctx: ctxForAudit(ctx), accion: "INVALIDAR", entidad: "participaciones", entidadId: input.id, valorAnterior: current, motivo: input.motivo, tx });
    });
    return { success: true, estado: "INVALIDADA" as const };
  }),

  /** @deprecated Use retirar (proveedor) o invalidar (admin). */
  delete: adminQuery.input(z.object({
    id: z.number().int().positive(),
    motivo: z.string().trim().min(3),
    estado: z.enum(["RETIRADA", "INVALIDADA"]).default("INVALIDADA"),
  })).mutation(async () => {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "participaciones.delete unificado está deshabilitado. Use retirar (proveedor) o invalidar (admin).",
    });
  }),
});
