import { z } from "zod";
import { eq, desc, like, and, count, asc, sql } from "drizzle-orm";
import { createRouter, convocanteQuery, adminQuery, authedQuery, proveedorQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { licitaciones, entidades, categorias, users, proveedores, participaciones, hitos, alertasSeguridad, aperturas, dictamenes, fallos } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { assertDateOrder, assertLicitacionReadyForPublish, assertLicitacionExists, nextLicitacionCode, validateWeights, validateRubric } from "../lib/domain";
import { findExpedienteByLicitacion, appendExpedienteEvent, createExpedienteForLicitacion } from "../lib/expediente";
import { assertAdjudicacionRequiresFallo, assertEvaluacionRequiresApertura } from "../lib/phase2-transitions";
import { assertNonNegativeDecimal, writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Importe inválido.");
const dateMx = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");

async function getByTenant(id: number, tenantId: number) {
  return getDb().query.licitaciones.findFirst({ where: and(eq(licitaciones.id, id), eq(licitaciones.tenantId, tenantId)), with: { entidad: true, categoria: true, convocante: true, proveedorGanador: true, participaciones: { with: { proveedor: true, evaluator: true } }, documentos: true, hitos: true } });
}

export const licitacionesRouter = createRouter({
  list: authedQuery.input(z.object({ estado: z.enum(["BORRADOR","CONSULTAS","PUBLICADA","EN_EVALUACION","ADJUDICADA","DESIERTA","CANCELADA","FINALIZADA","ARCHIVADA"]).optional(), search: z.string().trim().optional(), entidadId: z.number().int().positive().optional(), categoriaId: z.number().int().positive().optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(licitaciones.tenantId, ctx.user.tenantId)];
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
    if (ctx.user.role === "proveedor") {
      lic.participaciones = lic.participaciones.filter((p: any) => p.proveedor?.usuarioId === ctx.user.id);
      lic.documentos = lic.documentos.filter((d: any) => d.esPublico || d.proveedorId === lic.participaciones.find((p: any) => p.proveedor?.usuarioId === ctx.user.id)?.proveedorId);
    }
    return lic;
  }),

  create: convocanteQuery.input(z.object({
    titulo: z.string().trim().min(5).max(300), objeto: z.string().trim().min(10), descripcionDetallada: z.string().trim().optional(), entidadId: z.number().int().positive(), categoriaId: z.number().int().positive(), convocanteId: z.number().int().positive().optional(),
    tipoLicitacion: z.enum(["LICITACION_PUBLICA","INVITACION_RESTRINGIDA","ADJUDICACION_DIRECTA"]), tipoContratacion: z.enum(["OBRA","SERVICIO","BIENES","CONCESION","ARRENDAMIENTO"]), montoPresupuestado: money, fechaPublicacion: dateMx.optional(), fechaCierre: dateMx.optional(), fechaApertura: dateMx.optional(), criterioEvaluacion: z.enum(["PRECIO_MAS_BAJO","MEJOR_RELACION_CALIDAD_PRECIO","MEJOR_VALOR_TECNICO"]).default("MEJOR_RELACION_CALIDAD_PRECIO"), ponderacionTecnica: money.default("40.00"), ponderacionEconomica: money.default("60.00"), rubricaTecnica: z.string().optional(), modoEvaluacion: z.enum(["MANUAL","HIBRIDA","AUTOMATICA"]).default("HIBRIDA"),
  })).mutation(async ({ input, ctx }) => {
    assertNonNegativeDecimal(input.montoPresupuestado, "montoPresupuestado");
    validateWeights(input.ponderacionTecnica, input.ponderacionEconomica);
    const rubric = validateRubric(input.rubricaTecnica);
    if (input.modoEvaluacion === "AUTOMATICA" && !rubric) throw new TRPCError({ code: "BAD_REQUEST", message: "La evaluación automática requiere una rúbrica técnica válida." });
    assertDateOrder(input.fechaPublicacion, input.fechaCierre, input.fechaApertura);
    const db = getDb();
    const convocanteId = input.convocanteId ?? ctx.user.id;
    const [entidad, categoria, convocante] = await Promise.all([
      db.query.entidades.findFirst({ where: and(eq(entidades.id, input.entidadId), eq(entidades.tenantId, ctx.user.tenantId), eq(entidades.activa, true)) }),
      db.query.categorias.findFirst({ where: and(eq(categorias.id, input.categoriaId), eq(categorias.tenantId, ctx.user.tenantId), eq(categorias.activa, true)) }),
      db.query.users.findFirst({ where: and(eq(users.id, convocanteId), eq(users.tenantId, ctx.user.tenantId), eq(users.activo, true)) }),
    ]);
    if (!entidad || !categoria) throw new TRPCError({ code: "BAD_REQUEST", message: "Entidad y categoría deben existir, estar activas y pertenecer al tenant." });
    if (!convocante || !["admin","licitante"].includes(convocante.role)) throw new TRPCError({ code: "BAD_REQUEST", message: "El convocante debe ser administrador o licitante del tenant." });
    let createdId = 0; let codigo = "";
    await db.transaction(async tx => {
      codigo = await nextLicitacionCode(ctx.user.tenantId, tx);
      const result = await tx.insert(licitaciones).values({ tenantId: ctx.user.tenantId, codigo, titulo: input.titulo, objeto: input.objeto, descripcionDetallada: input.descripcionDetallada ?? null, entidadId: input.entidadId, categoriaId: input.categoriaId, convocanteId, tipoLicitacion: input.tipoLicitacion, tipoContratacion: input.tipoContratacion, montoPresupuestado: input.montoPresupuestado, moneda: "MXN", estado: "BORRADOR", etapa: "PREPARACION", fechaPublicacion: input.fechaPublicacion, fechaCierre: input.fechaCierre, fechaApertura: input.fechaApertura, criterioEvaluacion: input.criterioEvaluacion, ponderacionTecnica: input.ponderacionTecnica, ponderacionEconomica: input.ponderacionEconomica, rubricaTecnica: input.rubricaTecnica ?? null, modoEvaluacion: input.modoEvaluacion });
      createdId = Number(result[0].insertId);
      await createExpedienteForLicitacion(tx, ctx, { ...input, id: createdId, convocanteId, codigo, moneda: "MXN", estado: "BORRADOR", etapa: "PREPARACION" } as any);
    });
    const created = await getByTenant(createdId, ctx.user.tenantId);
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "licitaciones", entidadId: createdId, valorNuevo: created });
    return { id: createdId, codigo, item: created };
  }),

  update: convocanteQuery.input(z.object({
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

  agregarJunta: convocanteQuery.input(z.object({ id: z.number().int().positive(), fechaProgramada: z.string().datetime(), nombre: z.string().trim().min(3).default("Junta de Aclaraciones"), motivo: z.string().optional() })).mutation(async ({ input, ctx }) => {
    const lic = await assertLicitacionExists(ctx.user.tenantId, input.id);
    if (lic.estado !== "BORRADOR") throw new TRPCError({ code: "CONFLICT", message: "La junta se configura antes de publicar." });
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.id); if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La licitación no tiene expediente electrónico." });
    const db = getDb(); const result = await db.insert(hitos).values({ tenantId: ctx.user.tenantId, expedienteId: expediente.id, licitacionId: input.id, tipo: "JUNTA_ACLARACIONES", nombre: input.nombre, fechaProgramada: new Date(input.fechaProgramada), estado: "PENDIENTE" });
    const id = Number(result[0].insertId); const created = await db.query.hitos.findFirst({ where: and(eq(hitos.id, id), eq(hitos.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "hitos", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  publicar: convocanteQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const current = await assertLicitacionReadyForPublish(ctx.user.tenantId, input.id);
    const db = getDb();
    const result = await db.update(licitaciones).set({ estado: "PUBLICADA", etapa: "CONVOCATORIA", fechaPublicacion: current.fechaPublicacion ?? new Date().toISOString().slice(0,10) }).where(and(eq(licitaciones.id, input.id), eq(licitaciones.tenantId, ctx.user.tenantId), eq(licitaciones.estado, "BORRADOR")));
    if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "La licitación cambió de estado antes de publicarse; vuelva a cargar el expediente." });
    const updated = await getByTenant(input.id, ctx.user.tenantId);
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "PUBLICAR", entidad: "licitaciones", entidadId: input.id, valorAnterior: current, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),

  iniciarEvaluacion: convocanteQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const current = await assertLicitacionExists(ctx.user.tenantId, input.id);
    if (!['PUBLICADA','CONSULTAS'].includes(current.estado)) throw new TRPCError({ code: "CONFLICT", message: "Sólo una licitación publicada puede pasar a evaluación." });
    if (current.fechaCierre && current.fechaCierre > new Date().toISOString().slice(0,10)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La fecha de cierre aún no ha llegado." });
    const db = getDb();
    const apertura = await db.query.aperturas.findFirst({ where: and(eq(aperturas.tenantId, ctx.user.tenantId), eq(aperturas.licitacionId, input.id)) });
    assertEvaluacionRequiresApertura(apertura?.estado);
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.id);
    if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin expediente electrónico." });
    let updated;
    await db.transaction(async (tx) => {
      const result = await tx.update(licitaciones).set({ estado: "EN_EVALUACION", etapa: "EVALUACION" }).where(and(eq(licitaciones.id, input.id), eq(licitaciones.tenantId, ctx.user.tenantId), eq(licitaciones.estado, current.estado)));
      if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "La licitación cambió de estado antes de iniciar la evaluación." });
      await appendExpedienteEvent(tx, ctx, { expedienteId: expediente.id, tipo: "EVALUACION_INICIADA", estadoAnterior: current.estado, estadoNuevo: "EN_EVALUACION", motivo: input.motivo, payload: { licitacionId: input.id, aperturaId: apertura!.id } });
    });
    updated = await getByTenant(input.id, ctx.user.tenantId);
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "INICIAR_EVALUACION", entidad: "licitaciones", entidadId: input.id, valorAnterior: current, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),

  adjudicar: convocanteQuery.input(z.object({ id: z.number().int().positive(), proveedorGanadorId: z.number().int().positive(), montoAdjudicado: money, motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    assertNonNegativeDecimal(input.montoAdjudicado, "montoAdjudicado");
    const current = await assertLicitacionExists(ctx.user.tenantId, input.id);
    if (current.estado !== "EN_EVALUACION") throw new TRPCError({ code: "CONFLICT", message: "La licitación debe estar EN_EVALUACION antes de adjudicar." });
    const db = getDb();
    const provider = await db.query.proveedores.findFirst({ where: and(eq(proveedores.id, input.proveedorGanadorId), eq(proveedores.tenantId, ctx.user.tenantId), eq(proveedores.activo, true)) });
    if (!provider) throw new TRPCError({ code: "BAD_REQUEST", message: "El proveedor ganador no existe, está inactivo o pertenece a otro tenant." });
    if (provider.estadoVerificacion !== "VERIFICADO") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El proveedor ganador debe tener expediente VERIFICADO." });
    const offer = await db.query.participaciones.findFirst({ where: and(eq(participaciones.tenantId, ctx.user.tenantId), eq(participaciones.licitacionId, input.id), eq(participaciones.proveedorId, input.proveedorGanadorId)) });
    if (!offer) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El proveedor no presentó oferta en esta licitación." });
    if (offer.estadoEvaluacion !== "ADMISIBLE") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La oferta del proveedor no es admisible." });
    if (offer.puntajeTotal == null || offer.puntajeTecnico == null || offer.puntajeEconomico == null) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La oferta no tiene evaluación técnica y económica completa." });
    const higher = await db.select({ id: participaciones.id, proveedorId: participaciones.proveedorId }).from(participaciones).where(and(eq(participaciones.tenantId, ctx.user.tenantId), eq(participaciones.licitacionId, input.id), eq(participaciones.estadoEvaluacion, "ADMISIBLE"))).orderBy(desc(participaciones.puntajeTotal), asc(participaciones.id)).limit(1);
    if (!higher.length || higher[0].id !== offer.id) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El proveedor indicado no ocupa el primer lugar de la evaluación vigente." });
    if (Number(input.montoAdjudicado) !== Number(offer.montoOferta)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El monto adjudicado debe coincidir con la oferta ganadora." });
    const dictamen = await db.query.dictamenes.findFirst({ where: and(eq(dictamenes.tenantId, ctx.user.tenantId), eq(dictamenes.licitacionId, input.id), eq(dictamenes.estado, "APROBADO")), orderBy: [desc(dictamenes.version)] });
    const fallo = await db.query.fallos.findFirst({ where: and(eq(fallos.tenantId, ctx.user.tenantId), eq(fallos.licitacionId, input.id)) });
    assertAdjudicacionRequiresFallo({
      dictamenEstado: dictamen?.estado,
      falloEstado: fallo?.estado,
      falloSentido: fallo?.sentido,
      falloProveedorId: fallo?.proveedorGanadorId,
      falloMonto: fallo?.montoAdjudicado,
      proveedorGanadorId: input.proveedorGanadorId,
      montoAdjudicado: input.montoAdjudicado,
    });
    const blockingAlerts = await db.query.alertasSeguridad.findMany({ where: and(eq(alertasSeguridad.tenantId, ctx.user.tenantId), eq(alertasSeguridad.licitacionId, input.id), sql`${alertasSeguridad.severidad} IN ('ALTA','CRITICA')`, sql`${alertasSeguridad.estado} IN ('NUEVA','INVESTIGANDO','CONFIRMADA')`) });
    if (blockingAlerts.some(a => a.severidad === "CRITICA" || a.estado === "CONFIRMADA")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La adjudicación está bloqueada por alertas de riesgo de alta severidad que aún requieren resolución." });
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.id);
    if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin expediente electrónico." });
    await db.transaction(async tx => {
      const result = await tx.update(licitaciones).set({ estado: "ADJUDICADA", etapa: "ADJUDICACION", proveedorGanadorId: provider.id, montoAdjudicado: input.montoAdjudicado, fechaAdjudicacion: new Date().toISOString().slice(0,10) }).where(and(eq(licitaciones.id, input.id), eq(licitaciones.tenantId, ctx.user.tenantId), eq(licitaciones.estado, "EN_EVALUACION")));
      if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "La licitación ya fue adjudicada o cambió de estado por otro usuario." });
      await tx.update(participaciones).set({ estadoEvaluacion: "GANADORA", montoAdjudicadoFinal: input.montoAdjudicado }).where(and(eq(participaciones.id, offer.id), eq(participaciones.tenantId, ctx.user.tenantId)));
      await appendExpedienteEvent(tx, ctx, { expedienteId: expediente.id, tipo: "ADJUDICACION", estadoAnterior: "EN_EVALUACION", estadoNuevo: "ADJUDICADA", motivo: input.motivo, payload: { licitacionId: input.id, proveedorGanadorId: provider.id, montoAdjudicado: input.montoAdjudicado, falloId: fallo!.id, dictamenId: dictamen!.id } });
    });
    const updated = await getByTenant(input.id, ctx.user.tenantId);
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "ADJUDICAR", entidad: "licitaciones", entidadId: input.id, valorAnterior: current, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),

  delete: adminQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb(); const current = await assertLicitacionExists(ctx.user.tenantId, input.id);
    if (current.estado !== "BORRADOR") throw new TRPCError({ code: "CONFLICT", message: "Sólo se puede eliminar una licitación en BORRADOR." });
    await db.delete(licitaciones).where(and(eq(licitaciones.id, input.id), eq(licitaciones.tenantId, ctx.user.tenantId), eq(licitaciones.estado, "BORRADOR")));
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "ELIMINAR", entidad: "licitaciones", entidadId: input.id, valorAnterior: current, motivo: input.motivo });
    return { success: true };
  }),
});
