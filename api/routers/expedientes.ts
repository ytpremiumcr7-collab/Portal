import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, asc } from "drizzle-orm";
import { createRouter, adminQuery, convocanteQuery, capabilityQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { expedienteRequirements, expedientes } from "@db/schema";
import { pageInput, pageResult } from "../lib/pagination";
import { assertExpediente, assertExpedienteComplete, findExpedienteByLicitacion, appendExpedienteEvent, verifyExpedienteEvidenceChain } from "../lib/expediente";
import { ctxForAudit } from "../middleware";
import { writeAudit } from "../lib/security";
import { verifyDocumentStoreIntegrity } from "../lib/document-integrity";

const requirementState = z.enum(["PENDIENTE", "CUMPLIDO", "OBSERVADO", "NO_APLICA"]);

export const expedientesRouter = createRouter({
  list: convocanteQuery.input(z.object({ estado: z.enum(["INTEGRACION","REVISION_JURIDICA","APROBADO","OBSERVADO","CERRADO","ARCHIVADO"]).optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(expedientes.tenantId, ctx.user.tenantId)];
    if (input?.estado) conditions.push(eq(expedientes.estado, input.estado));
    const where = and(...conditions);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.expedientes.findMany({ where, orderBy: [desc(expedientes.updatedAt)], limit: pageSize, offset, with: { licitacion: true } }),
      db.select({ total: count() }).from(expedientes).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  getByLicitacion: convocanteQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const item = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Expediente no encontrado." });
    return item;
  }),

  requirements: convocanteQuery.input(z.object({ expedienteId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    return getDb().query.expedienteRequirements.findMany({ where: and(eq(expedienteRequirements.tenantId, ctx.user.tenantId), eq(expedienteRequirements.expedienteId, input.expedienteId)), orderBy: [asc(expedienteRequirements.id)] });
  }),

  markRequirement: capabilityQuery("aprobar_juridico").input(z.object({ id: z.number().int().positive(), estado: requirementState, observaciones: z.string().trim().max(2000).nullable().optional(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const current = await db.query.expedienteRequirements.findFirst({ where: and(eq(expedienteRequirements.id, input.id), eq(expedienteRequirements.tenantId, ctx.user.tenantId)) });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Requisito no encontrado." });
    if (input.estado === "CUMPLIDO" && !current.documentoActualId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Un requisito documental no puede marcarse CUMPLIDO sin documento aprobado." });
    await db.update(expedienteRequirements).set({ estado: input.estado, observaciones: input.observaciones ?? current.observaciones, validadoPor: ctx.user.id, validadoAt: new Date() }).where(and(eq(expedienteRequirements.id, input.id), eq(expedienteRequirements.tenantId, ctx.user.tenantId)));
    const updated = await db.query.expedienteRequirements.findFirst({ where: and(eq(expedienteRequirements.id, input.id), eq(expedienteRequirements.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "REQUISITO_EXPEDIENTE", entidad: "expediente_requirements", entidadId: input.id, valorAnterior: current, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),

  enviarRevisionJuridica: capabilityQuery("aprobar_juridico").input(z.object({ expedienteId: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const current = await assertExpediente(ctx.user.tenantId, input.expedienteId);
    if (!["INTEGRACION", "OBSERVADO"].includes(current.estado)) throw new TRPCError({ code: "CONFLICT", message: "El expediente sólo puede enviarse a revisión desde INTEGRACION u OBSERVADO." });
    await assertExpedienteComplete(ctx.user.tenantId, current.id);
    const db = getDb();
    await db.transaction(async (tx) => {
      const result = await tx.update(expedientes).set({ estado: "REVISION_JURIDICA", version: current.version + 1 }).where(and(eq(expedientes.id, current.id), eq(expedientes.tenantId, ctx.user.tenantId), eq(expedientes.estado, current.estado)));
      if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "El expediente cambió mientras se procesaba." });
      await appendExpedienteEvent(tx, ctx, { expedienteId: current.id, tipo: "ENVIO_REVISION_JURIDICA", estadoAnterior: current.estado, estadoNuevo: "REVISION_JURIDICA", motivo: input.motivo });
    });
    const updated = await assertExpediente(ctx.user.tenantId, current.id);
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "ENVIAR_REVISION_JURIDICA", entidad: "expedientes", entidadId: current.id, valorAnterior: current, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),

  resolverRevision: adminQuery.input(z.object({ expedienteId: z.number().int().positive(), decision: z.enum(["APROBAR", "OBSERVAR"]), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const current = await assertExpediente(ctx.user.tenantId, input.expedienteId);
    if (current.estado !== "REVISION_JURIDICA") throw new TRPCError({ code: "CONFLICT", message: "El expediente no está en revisión jurídica." });
    const next = input.decision === "APROBAR" ? "APROBADO" : "OBSERVADO";
    const db = getDb();
    await db.transaction(async (tx) => {
      const result = await tx.update(expedientes).set({ estado: next, version: current.version + 1 }).where(and(eq(expedientes.id, current.id), eq(expedientes.tenantId, ctx.user.tenantId), eq(expedientes.estado, "REVISION_JURIDICA")));
      if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "El expediente cambió mientras se resolvía." });
      await appendExpedienteEvent(tx, ctx, { expedienteId: current.id, tipo: input.decision === "APROBAR" ? "APROBACION_JURIDICA" : "OBSERVACION_JURIDICA", estadoAnterior: current.estado, estadoNuevo: next, motivo: input.motivo });
    });
    const updated = await assertExpediente(ctx.user.tenantId, current.id);
    await writeAudit({ ctx: ctxForAudit(ctx), accion: input.decision === "APROBAR" ? "APROBAR_EXPEDIENTE" : "OBSERVAR_EXPEDIENTE", entidad: "expedientes", entidadId: current.id, valorAnterior: current, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),

  verifyEvidence: adminQuery.input(z.object({ expedienteId: z.number().int().positive() })).query(async ({ input, ctx }) => verifyExpedienteEvidenceChain(ctx.user.tenantId, input.expedienteId)),

  events: convocanteQuery.input(z.object({ expedienteId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const exp = await assertExpediente(ctx.user.tenantId, input.expedienteId);
    return exp.events;
  }),

  verifyStoreIntegrity: adminQuery.input(z.object({
    documentoId: z.number().int().positive().optional(),
    expedienteId: z.number().int().positive().optional(),
    licitacionId: z.number().int().positive().optional(),
  }).optional()).query(async ({ input, ctx }) => {
    return verifyDocumentStoreIntegrity({
      tenantId: ctx.user.tenantId,
      documentoId: input?.documentoId,
      expedienteId: input?.expedienteId,
      licitacionId: input?.licitacionId,
    });
  }),
});
