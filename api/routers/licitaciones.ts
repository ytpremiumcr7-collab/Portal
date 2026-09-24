import { z } from "zod";
import { eq, desc, like, and, count, isNull, ne } from "drizzle-orm";
import { createRouter, capabilityQuery, procedureMutation, adminQuery, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { licitaciones, entidades, categorias, users, proveedores, hitos, aperturas, licitacionReglasVersion, procedimientoAsignaciones } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { assertDateOrder, assertLicitacionReadyForPublish, assertLicitacionExists, nextLicitacionCode, validateWeights, validateRubric, listHitosTiposConfigurados, assertJuntaSiPoliticaLoExige } from "../lib/domain";
import { findExpedienteByLicitacion, appendExpedienteEvent, createExpedienteForLicitacion } from "../lib/expediente";
import { assertEvaluacionRequiresApertura, policyRequiresAperturaPublica } from "../lib/phase2-transitions";
import { assertNonNegativeDecimal, writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";
import { hashReglas, type CriterioEvaluacion, type FrozenReglas } from "../lib/evaluation-engine";
import { licitacionIdFromInput } from "../lib/procedure-resolvers";
import { parseTieBreakPolicy, parseActosObligatorios, assertActosPermitidosPorPolitica, resolvePolicyForPublish, policyRequiresJunta, assertTransitionAllowed, mergeModalidadRequisitos } from "../lib/procedure-policy";
import { enqueueOutbox } from "../lib/outbox";
import { assertCalendarioPermite } from "../lib/calendario-gates";
import { loadAperturaEstado, redactParticipacionEconomica } from "../lib/sobre-economico";
import { awards, organizationalUnits, procedureLots, procedureTeamMembers } from "@db/schema-eproc";
import { assertUnitAuthority } from "../lib/institutional-authority";
import { instantiateProcedureWorkflow, assertProcedureTaskApproved } from "../lib/workflow";
import { recordPublicationRelease } from "../lib/publication-ledger";
import { supplierProviderIdsForUser } from "../lib/supplier-authority";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Importe inválido.");
const dateMx = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");

async function getByTenant(id: number, tenantId: number) {
  return getDb().query.licitaciones.findFirst({ where: and(eq(licitaciones.id, id), eq(licitaciones.tenantId, tenantId)), with: { entidad: true, categoria: true, convocante: true, proveedorGanador: true, participaciones: { with: { proveedor: true, evaluator: true } }, documentos: true, hitos: true } });
}

export const licitacionesRouter = createRouter({
  list: authedQuery.input(z.object({ estado: z.enum(["BORRADOR","CONSULTAS","PUBLICADA","EN_EVALUACION","ADJUDICADA","DESIERTA","CANCELADA","FINALIZADA","ARCHIVADA"]).optional(), search: z.string().trim().optional(), entidadId: z.number().int().positive().optional(), categoriaId: z.number().int().positive().optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [
      eq(licitaciones.tenantId, ctx.user.tenantId),
      isNull(licitaciones.deletedAt),
      ne(licitaciones.estado, "ELIMINADA"),
    ];
    if (ctx.user.role === "proveedor") conditions.push(eq(licitaciones.estado, "PUBLICADA"));
    if (input?.estado) conditions.push(eq(licitaciones.estado, input.estado));
    if (input?.search) conditions.push(like(licitaciones.titulo, `%${input.search}%`));
    if (input?.entidadId) conditions.push(eq(licitaciones.entidadId, input.entidadId));
    if (input?.categoriaId) conditions.push(eq(licitaciones.categoriaId, input.categoriaId));
    const where = and(...conditions);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.licitaciones.findMany({ where, orderBy: [desc(licitaciones.createdAt)], limit: pageSize, offset, with: { entidad: true, categoria: true, proveedorGanador: true } }),
      db.select({ total: count() }).from(licitaciones).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  getById: authedQuery.input(z.object({ id: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const lic = await getByTenant(input.id, ctx.user.tenantId);
    if (!lic) throw new TRPCError({ code: "NOT_FOUND", message: "Licitación no encontrada." });
    if (((lic as any).deletedAt || lic.estado === "ELIMINADA") && ctx.user.role !== "admin") {
      throw new TRPCError({ code: "NOT_FOUND", message: "Licitación no encontrada." });
    }
    let representedProviderIds = new Set<number>();
    if (ctx.user.role === "proveedor") {
      representedProviderIds = new Set(await supplierProviderIdsForUser(ctx.user.tenantId, ctx.user.id));
      lic.participaciones = lic.participaciones.filter((p: any) => representedProviderIds.has(Number(p.proveedorId)));
      lic.documentos = lic.documentos.filter((d: any) => d.esPublico || (d.proveedorId != null && representedProviderIds.has(Number(d.proveedorId))));
    }
    const aperturaEstado = await loadAperturaEstado(ctx.user.tenantId, lic.id);
    lic.participaciones = lic.participaciones.map((p: any) =>
      redactParticipacionEconomica(p, {
        role: ctx.user.role,
        viewerProveedorId: ctx.user.role === "proveedor" && representedProviderIds.has(Number(p.proveedorId)) ? p.proveedorId : null,
        itemProveedorId: p.proveedorId,
        aperturaEstado,
      }),
    );
    const awardRows = await getDb().select({
      id: awards.id,
      lotId: awards.lotId,
      lotCode: procedureLots.code,
      lotTitle: procedureLots.title,
      proveedorId: awards.proveedorId,
      proveedor: proveedores.razonSocial,
      amount: awards.amount,
      currency: awards.currency,
      status: awards.status,
      publishedAt: awards.publishedAt,
    }).from(awards)
      .innerJoin(procedureLots, and(eq(procedureLots.tenantId, awards.tenantId), eq(procedureLots.id, awards.lotId)))
      .innerJoin(proveedores, and(eq(proveedores.tenantId, awards.tenantId), eq(proveedores.id, awards.proveedorId)))
      .where(and(eq(awards.tenantId, ctx.user.tenantId), eq(awards.licitacionId, lic.id)))
      .orderBy(procedureLots.id);
    return { ...lic, awards: awardRows };
  }),

  create: capabilityQuery("crear_procedimiento").input(z.object({
    titulo: z.string().trim().min(5).max(300), objeto: z.string().trim().min(10), descripcionDetallada: z.string().trim().optional(), entidadId: z.number().int().positive(), contractingUnitId: z.number().int().positive(), categoriaId: z.number().int().positive(), convocanteId: z.number().int().positive().optional(),
    tipoLicitacion: z.enum(["LICITACION_PUBLICA","INVITACION_RESTRINGIDA","INVITACION_TRES","ADJUDICACION_DIRECTA","DIALOGO_COMPETITIVO","ADJUDICACION_DIRECTA_NEGOCIACION","ACUERDO_MARCO_ASIGNACION","TIENDA_DIGITAL_ORDEN"]), tipoContratacion: z.enum(["OBRA","SERVICIO","BIENES","CONCESION","ARRENDAMIENTO"]), montoPresupuestado: money, fechaPublicacion: dateMx.optional(), fechaCierre: dateMx.optional(), fechaApertura: dateMx.optional(), criterioEvaluacion: z.enum(["PRECIO_MAS_BAJO","MEJOR_RELACION_CALIDAD_PRECIO","MEJOR_VALOR_TECNICO"]).default("MEJOR_RELACION_CALIDAD_PRECIO"), ponderacionTecnica: money.default("40.00"), ponderacionEconomica: money.default("60.00"), rubricaTecnica: z.string().optional(), modoEvaluacion: z.enum(["MANUAL","HIBRIDA","AUTOMATICA"]).default("HIBRIDA"),
  })).mutation(async ({ input, ctx }) => {
    assertNonNegativeDecimal(input.montoPresupuestado, "montoPresupuestado");
    validateWeights(input.ponderacionTecnica, input.ponderacionEconomica);
    const rubric = validateRubric(input.rubricaTecnica);
    if (input.modoEvaluacion === "AUTOMATICA" && !rubric) throw new TRPCError({ code: "BAD_REQUEST", message: "La evaluación automática requiere una rúbrica técnica válida." });
    assertDateOrder(input.fechaPublicacion, input.fechaCierre, input.fechaApertura);
    const db = getDb();
    const convocanteId = input.convocanteId ?? ctx.user.id;
    const [entidad, categoria, convocante, contractingUnit] = await Promise.all([
      db.query.entidades.findFirst({ where: and(eq(entidades.id, input.entidadId), eq(entidades.tenantId, ctx.user.tenantId), eq(entidades.activa, true)) }),
      db.query.categorias.findFirst({ where: and(eq(categorias.id, input.categoriaId), eq(categorias.tenantId, ctx.user.tenantId), eq(categorias.activa, true)) }),
      db.query.users.findFirst({ where: and(eq(users.id, convocanteId), eq(users.tenantId, ctx.user.tenantId), eq(users.activo, true)) }),
      db.query.organizationalUnits.findFirst({ where: and(eq(organizationalUnits.id, input.contractingUnitId), eq(organizationalUnits.tenantId, ctx.user.tenantId), eq(organizationalUnits.entidadId, input.entidadId), eq(organizationalUnits.active, true)) }),
    ]);
    if (!entidad || !categoria) throw new TRPCError({ code: "BAD_REQUEST", message: "Entidad y categoría deben existir, estar activas y pertenecer al tenant." });
    if (!contractingUnit || contractingUnit.unitType !== "UNIDAD_COMPRADORA") throw new TRPCError({ code: "BAD_REQUEST", message: "Seleccione una unidad compradora activa de la entidad." });
    if (!convocante || !["admin","licitante"].includes(convocante.role)) throw new TRPCError({ code: "BAD_REQUEST", message: "El convocante debe ser administrador o licitante del tenant." });
    const creatorAuthority = await assertUnitAuthority(ctx.user, input.contractingUnitId, ["OPERADOR"], { actionCode: "CREAR_PROCEDIMIENTO" });
    let createdId = 0; let codigo = "";
    await db.transaction(async tx => {
      codigo = await nextLicitacionCode(ctx.user.tenantId, tx);
      const result = await tx.insert(licitaciones).values({ tenantId: ctx.user.tenantId, codigo, titulo: input.titulo, objeto: input.objeto, descripcionDetallada: input.descripcionDetallada ?? null, entidadId: input.entidadId, contractingUnitId: input.contractingUnitId, categoriaId: input.categoriaId, convocanteId, tipoLicitacion: input.tipoLicitacion, tipoContratacion: input.tipoContratacion, montoPresupuestado: input.montoPresupuestado, moneda: "MXN", estado: "BORRADOR", etapa: "PREPARACION", fechaPublicacion: input.fechaPublicacion ? new Date(input.fechaPublicacion) : null, fechaCierre: input.fechaCierre ? new Date(input.fechaCierre) : null, fechaApertura: input.fechaApertura ? new Date(input.fechaApertura) : null, criterioEvaluacion: input.criterioEvaluacion, ponderacionTecnica: input.ponderacionTecnica, ponderacionEconomica: input.ponderacionEconomica, rubricaTecnica: input.rubricaTecnica ?? null, modoEvaluacion: input.modoEvaluacion });
      createdId = Number(result[0].insertId);
      await createExpedienteForLicitacion(tx, ctx, { ...input, id: createdId, convocanteId, codigo, moneda: "MXN", estado: "BORRADOR", etapa: "PREPARACION" } as any);
      await tx.insert(procedimientoAsignaciones).values({
        tenantId: ctx.user.tenantId, licitacionId: createdId, userId: ctx.user.id,
        rol: "creador", overrideSod: false, justificacionOverride: null, asignadoPor: ctx.user.id,
      } as any);
      await tx.insert(procedureTeamMembers).values({
        tenantId: ctx.user.tenantId, licitacionId: createdId, unitId: input.contractingUnitId,
        userId: ctx.user.id, institutionalRole: "OPERADOR", procedureRole: "creador",
        authoritySource: creatorAuthority.source, authorityRefId: creatorAuthority.authorityId,
        authoritySnapshot: creatorAuthority,
      } as any);
      await tx.insert(procedureLots).values({
        tenantId: ctx.user.tenantId, licitacionId: createdId, code: "GENERAL",
        title: "Lote general", status: "ACTIVE", estimatedAmount: input.montoPresupuestado,
        currency: "MXN", createdBy: ctx.user.id,
      } as any);
      await instantiateProcedureWorkflow(tx, {
        tenantId: ctx.user.tenantId, licitacionId: createdId,
        unitId: input.contractingUnitId, actorUserId: ctx.user.id,
      });
      await writeAudit({
        ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "licitaciones", entidadId: createdId,
        valorNuevo: { id: createdId, codigo, contractingUnitId: input.contractingUnitId, authority: creatorAuthority },
        tx,
      });
    });
    const created = await getByTenant(createdId, ctx.user.tenantId);
    return { id: createdId, codigo, item: created };
  }),

  update: procedureMutation({ capability: "crear_procedimiento", role: "creador", resolveLicitacionId: (i) => licitacionIdFromInput(i) }).input(z.object({
    id: z.number().int().positive(), titulo: z.string().trim().min(5).max(300).optional(), objeto: z.string().trim().min(10).optional(), descripcionDetallada: z.string().nullable().optional(), montoPresupuestado: money.optional(), fechaPublicacion: dateMx.nullable().optional(), fechaCierre: dateMx.nullable().optional(), fechaApertura: dateMx.nullable().optional(), criterioEvaluacion: z.enum(["PRECIO_MAS_BAJO","MEJOR_RELACION_CALIDAD_PRECIO","MEJOR_VALOR_TECNICO"]).optional(), ponderacionTecnica: money.optional(), ponderacionEconomica: money.optional(), rubricaTecnica: z.string().nullable().optional(), modoEvaluacion: z.enum(["MANUAL","HIBRIDA","AUTOMATICA"]).optional(), motivo: z.string().trim().min(3).optional(),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const current = await assertLicitacionExists(ctx.user.tenantId, input.id);
    if (!["BORRADOR","CONSULTAS"].includes(current.estado)) throw new TRPCError({ code: "CONFLICT", message: "Una licitación publicada/en evaluación no se edita por CRUD; use el workflow." });
    const nextPub = input.fechaPublicacion === undefined ? current.fechaPublicacion : input.fechaPublicacion;
    const nextClose = input.fechaCierre === undefined ? current.fechaCierre : input.fechaCierre;
    const nextOpen = input.fechaApertura === undefined ? current.fechaApertura : input.fechaApertura;
    assertDateOrder(nextPub, nextClose, nextOpen);
    const tech = input.ponderacionTecnica ?? current.ponderacionTecnica; const econ = input.ponderacionEconomica ?? current.ponderacionEconomica;
    validateWeights(tech, econ); validateRubric(input.rubricaTecnica ?? current.rubricaTecnica); if (input.montoPresupuestado) assertNonNegativeDecimal(input.montoPresupuestado, "montoPresupuestado");
    const data: Record<string, unknown> = {}; for (const [key, value] of Object.entries(input)) if (key !== "id" && key !== "motivo" && value !== undefined) data[key] = value;
    await db.update(licitaciones).set(data as any).where(and(eq(licitaciones.id, input.id), eq(licitaciones.tenantId, ctx.user.tenantId)));
    const updated = await getByTenant(input.id, ctx.user.tenantId);
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "ACTUALIZAR", entidad: "licitaciones", entidadId: input.id, valorAnterior: current, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),

  agregarJunta: procedureMutation({ capability: "crear_procedimiento", role: "creador", resolveLicitacionId: (i) => licitacionIdFromInput(i) }).input(z.object({ id: z.number().int().positive(), fechaProgramada: z.string().datetime(), nombre: z.string().trim().min(3).default("Junta de Aclaraciones"), motivo: z.string().optional() })).mutation(async ({ input, ctx }) => {
    const lic = await assertLicitacionExists(ctx.user.tenantId, input.id);
    if (lic.estado !== "BORRADOR") throw new TRPCError({ code: "CONFLICT", message: "La junta se configura antes de publicar." });
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.id); if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La licitación no tiene expediente electrónico." });
    const db = getDb(); const result = await db.insert(hitos).values({ tenantId: ctx.user.tenantId, expedienteId: expediente.id, licitacionId: input.id, tipo: "JUNTA_ACLARACIONES", nombre: input.nombre, fechaProgramada: new Date(input.fechaProgramada), estado: "PENDIENTE" });
    const id = Number(result[0].insertId); const created = await db.query.hitos.findFirst({ where: and(eq(hitos.id, id), eq(hitos.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "hitos", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  publicar: procedureMutation({ capability: "publicar", role: "creador", resolveLicitacionId: (i) => licitacionIdFromInput(i) }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const current = await assertLicitacionReadyForPublish(ctx.user.tenantId, input.id);
    await assertProcedureTaskApproved(ctx.user.tenantId, input.id, "AUTORIZAR_PUBLICACION");
    const db = getDb();
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.id);
    if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin expediente electrónico." });
    const frozen: FrozenReglas = {
      criterioEvaluacion: current.criterioEvaluacion as CriterioEvaluacion,
      ponderacionTecnica: current.ponderacionTecnica,
      ponderacionEconomica: current.ponderacionEconomica,
      modoEvaluacion: current.modoEvaluacion,
      tipoLicitacion: current.tipoLicitacion,
      tipoContratacion: current.tipoContratacion,
      marcoJuridico: expediente.marcoJuridico,
      rubricaTecnica: current.rubricaTecnica ?? null,
    };
    const reglasHash = hashReglas(frozen);
    // Policy REQUIRED: modalidad + regime (OBRA→LOPSRM else LAASSP / expediente.marco), highest version.
    const policy = await resolvePolicyForPublish(db, {
      modalidad: current.tipoLicitacion as any,
      tipoContratacion: current.tipoContratacion,
      marcoJuridico: expediente.marcoJuridico,
      modalidadMeta: (current as any).modalidadMeta ?? null,
    });
    const tieBreak = parseTieBreakPolicy(policy.tieBreakPolicy);
    const actos = parseActosObligatorios(policy.actosObligatorios);
    const hitosTipos = await listHitosTiposConfigurados(ctx.user.tenantId, input.id);
    assertActosPermitidosPorPolitica(current.tipoLicitacion as any, actos, hitosTipos);
    await assertJuntaSiPoliticaLoExige(ctx.user.tenantId, input.id, policyRequiresJunta(actos));
    await db.transaction(async (tx) => {
      const result = await tx.update(licitaciones).set({ estado: "PUBLICADA", etapa: "CONVOCATORIA", fechaPublicacion: current.fechaPublicacion ?? new Date(), policyId: policy.id, policyVersionId: policy.id } as any).where(and(eq(licitaciones.id, input.id), eq(licitaciones.tenantId, ctx.user.tenantId), eq(licitaciones.estado, "BORRADOR")));
      if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "La licitación cambió de estado antes de publicarse; vuelva a cargar el expediente." });
      // Freeze evaluation parameters at publish — evaluation/adjudicación MUST read this version. policyId NOT NULL.
      await tx.insert(licitacionReglasVersion).values({
        tenantId: ctx.user.tenantId,
        licitacionId: input.id,
        version: 1,
        criterioEvaluacion: frozen.criterioEvaluacion,
        ponderacionTecnica: String(Number(frozen.ponderacionTecnica).toFixed(2)),
        ponderacionEconomica: String(Number(frozen.ponderacionEconomica).toFixed(2)),
        modoEvaluacion: frozen.modoEvaluacion,
        tipoLicitacion: frozen.tipoLicitacion,
        tipoContratacion: frozen.tipoContratacion,
        marcoJuridico: frozen.marcoJuridico,
        rubricaTecnica: frozen.rubricaTecnica,
        reglasHash,
        policyId: policy.id,
        policyHash: policy.hash,
        tieBreakPolicy: tieBreak,
        actosObligatorios: actos,
        requisitos: policy.requisitos ?? null,
        publishedBy: ctx.user.id,
      } as any);
      await appendExpedienteEvent(tx, ctx, {
        expedienteId: expediente.id, tipo: "REGLAS_EVALUACION_CONGELADAS",
        estadoAnterior: "BORRADOR", estadoNuevo: "PUBLICADA", motivo: input.motivo,
        payload: { reglasHash, criterioEvaluacion: frozen.criterioEvaluacion, version: 1, policyId: policy.id, policyHash: policy.hash },
      });
      const updatedInTx = await tx.query.licitaciones.findFirst({ where: and(eq(licitaciones.id, input.id), eq(licitaciones.tenantId, ctx.user.tenantId)) });
      await recordPublicationRelease(tx, {
        tenantId: ctx.user.tenantId, licitacionId: input.id, eventType: "TENDER_PUBLISHED",
        sourceType: "licitaciones", sourceId: input.id, publishedBy: ctx.user.id,
        payload: {
          codigo: current.codigo, titulo: current.titulo, objeto: current.objeto,
          tipoLicitacion: current.tipoLicitacion, tipoContratacion: current.tipoContratacion,
          fechaPublicacion: current.fechaPublicacion ?? new Date(), fechaCierre: current.fechaCierre,
          fechaApertura: current.fechaApertura, policyId: policy.id, policyHash: policy.hash, reglasHash,
        },
      });
      await enqueueOutbox(tx, {
        tenantId: ctx.user.tenantId, aggregateType: "licitaciones", aggregateId: input.id,
        eventType: "PROCEDIMIENTO_PUBLICADO",
        payload: { licitacionId: input.id, codigo: current.codigo, actorUserId: ctx.user.id, entidadRef: "licitaciones", entidadId: input.id },
      });
      await writeAudit({ ctx: ctxForAudit(ctx), accion: "PUBLICAR", entidad: "licitaciones", entidadId: input.id, valorAnterior: current, valorNuevo: updatedInTx, motivo: input.motivo, tx });
    });
    return getByTenant(input.id, ctx.user.tenantId);
  }),

  iniciarEvaluacion: procedureMutation({ capability: "evaluar_tecnico", roles: ["evaluador_tecnico", "creador"], resolveLicitacionId: (i) => licitacionIdFromInput(i) }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const current = await assertLicitacionExists(ctx.user.tenantId, input.id);
    await assertCalendarioPermite(ctx.user.tenantId, input.id, "EVALUACION");
    if (!['PUBLICADA','CONSULTAS'].includes(current.estado)) throw new TRPCError({ code: "CONFLICT", message: "Sólo una licitación publicada puede pasar a evaluación." });
    // Reception/evaluation clocks: calendario jurídico only (assertCalendarioPermite above). Never day-granularity fechaCierre.
    const db = getDb();
    const apertura = await db.query.aperturas.findFirst({ where: and(eq(aperturas.tenantId, ctx.user.tenantId), eq(aperturas.licitacionId, input.id)) });
    const frozenForGate = await db.query.licitacionReglasVersion.findFirst({
      where: and(eq(licitacionReglasVersion.tenantId, ctx.user.tenantId), eq(licitacionReglasVersion.licitacionId, input.id)),
      orderBy: [desc(licitacionReglasVersion.version)],
    });
    const actosGate = Array.isArray((frozenForGate as any)?.actosObligatorios)
      ? (frozenForGate as any).actosObligatorios.map(String)
      : null;
    const requiereApertura = policyRequiresAperturaPublica(actosGate);
    assertEvaluacionRequiresApertura(apertura?.estado, {
      requiereAperturaPublica: requiereApertura,
      modalidad: current.tipoLicitacion,
    });
    assertTransitionAllowed(
      current.tipoLicitacion as any,
      "EVALUACION",
      mergeModalidadRequisitos((frozenForGate as any)?.requisitos, (current as any).modalidadMeta),
    );
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.id);
    if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin expediente electrónico." });
    let updated;
    await db.transaction(async (tx) => {
      const result = await tx.update(licitaciones).set({ estado: "EN_EVALUACION", etapa: "EVALUACION" }).where(and(eq(licitaciones.id, input.id), eq(licitaciones.tenantId, ctx.user.tenantId), eq(licitaciones.estado, current.estado)));
      if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "La licitación cambió de estado antes de iniciar la evaluación." });
      await appendExpedienteEvent(tx, ctx, { expedienteId: expediente.id, tipo: "EVALUACION_INICIADA", estadoAnterior: current.estado, estadoNuevo: "EN_EVALUACION", motivo: input.motivo, payload: { licitacionId: input.id, aperturaId: apertura?.id ?? null, requiereAperturaPublica: requiereApertura } });
    });
    updated = await getByTenant(input.id, ctx.user.tenantId);
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "INICIAR_EVALUACION", entidad: "licitaciones", entidadId: input.id, valorAnterior: current, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),

  setModalidadMeta: procedureMutation({ capability: "crear_procedimiento", role: "creador", resolveLicitacionId: (i) => licitacionIdFromInput(i) }).input(z.object({
    id: z.number().int().positive(),
    modalidadMeta: z.object({
      autorizacionComiteRef: z.string().trim().min(1).optional(),
      autorizadoPorHacienda: z.union([z.boolean(), z.string()]).optional(),
      acuerdoMarcoId: z.string().trim().min(1).optional(),
      acuerdoMarcoRef: z.string().trim().min(1).optional(),
      tiendaCatalogoRef: z.string().trim().min(1).optional(),
      ordenCompraRef: z.string().trim().min(1).optional(),
      notasNegociacion: z.string().trim().min(1).optional(),
      requiereFirmaElectronicaAvanzada: z.boolean().optional(),
    }),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const current = await assertLicitacionExists(ctx.user.tenantId, input.id);
    if (current.estado !== "BORRADOR") {
      throw new TRPCError({ code: "CONFLICT", message: "modalidadMeta sólo se edita en BORRADOR." });
    }
    const prev = ((current as any).modalidadMeta && typeof (current as any).modalidadMeta === "object")
      ? (current as any).modalidadMeta as Record<string, unknown>
      : {};
    const merged = { ...prev, ...input.modalidadMeta };
    const db = getDb();
    await db.update(licitaciones).set({ modalidadMeta: merged } as any)
      .where(and(eq(licitaciones.id, input.id), eq(licitaciones.tenantId, ctx.user.tenantId)));
    const updated = await getByTenant(input.id, ctx.user.tenantId);
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "ACTUALIZAR", entidad: "licitaciones", entidadId: input.id, valorAnterior: { modalidadMeta: prev }, valorNuevo: { modalidadMeta: merged }, motivo: input.motivo });
    return updated;
  }),

  delete: adminQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb(); const current = await assertLicitacionExists(ctx.user.tenantId, input.id);
    if ((current as any).deletedAt || current.estado === "ELIMINADA") {
      throw new TRPCError({ code: "CONFLICT", message: "La licitación ya está eliminada (soft-delete)." });
    }
    if (current.estado !== "BORRADOR") throw new TRPCError({ code: "CONFLICT", message: "Sólo se puede eliminar una licitación en BORRADOR." });
    // Soft-delete preserves expediente / audit trail — hard DELETE is forbidden.
    const now = new Date();
    await db.transaction(async (tx) => {
      const result = await tx.update(licitaciones).set({
        estado: "ELIMINADA",
        deletedAt: now,
      } as any).where(and(
        eq(licitaciones.id, input.id),
        eq(licitaciones.tenantId, ctx.user.tenantId),
        eq(licitaciones.estado, "BORRADOR"),
      ));
      if (Number(result[0]?.affectedRows ?? 0) !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "No se pudo soft-eliminar (estado cambió)." });
      }
      await writeAudit({
        ctx: ctxForAudit(ctx), accion: "ELIMINAR_SOFT", entidad: "licitaciones", entidadId: input.id,
        valorAnterior: current, valorNuevo: { estado: "ELIMINADA", deletedAt: now }, motivo: input.motivo, tx,
      });
    });
    return { success: true, softDeleted: true as const };
  }),
});
