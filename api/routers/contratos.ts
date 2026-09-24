import { z } from "zod";
import { and, count, desc, eq, getTableColumns, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, procedureMutation, authedQuery, ctxForAudit } from "../middleware";
import { licitacionIdFromAward, licitacionIdFromContrato } from "../lib/procedure-resolvers";
import { getDb } from "../queries/connection";
import { contratos, fallos, licitaciones, documentos, garantias, proveedores } from "@db/schema";
import { awards, procedureLots } from "@db/schema-eproc";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";
import { assertLicitacionExists } from "../lib/domain";
import { assertContratoTransition } from "../lib/phase2-transitions";
import type { ContratoEstado } from "../lib/phase2-transitions";
import { assertGarantiasRequeridasActivas } from "../lib/garantia-gates";
import { writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";
import { enqueueOutbox } from "../lib/outbox";
import type { OutboxEventType } from "../lib/outbox";
import { assertDocumentoBoundToContext } from "../lib/documento-binding";
import type { TrpcContext } from "../context";

const dateMx = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");
const asUtcDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

export const contratosRouter = createRouter({
  list: authedQuery.input(z.object({ licitacionId: z.number().int().positive().optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(contratos.tenantId, ctx.user.tenantId)];
    if (input?.licitacionId) conditions.push(eq(contratos.licitacionId, input.licitacionId));
    const where = and(...conditions);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.select({
        ...getTableColumns(contratos),
        lotId: awards.lotId,
        lotCode: procedureLots.code,
        lotTitle: procedureLots.title,
      }).from(contratos)
        .leftJoin(awards, and(eq(awards.tenantId, contratos.tenantId), eq(awards.id, contratos.awardId)))
        .leftJoin(procedureLots, and(eq(procedureLots.tenantId, awards.tenantId), eq(procedureLots.id, awards.lotId)))
        .where(where)
        .orderBy(desc(contratos.createdAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ total: count() }).from(contratos).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  getById: authedQuery.input(z.object({ id: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const item = await getDb().query.contratos.findFirst({ where: and(eq(contratos.id, input.id), eq(contratos.tenantId, ctx.user.tenantId)), with: { garantias: true } });
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
    return item;
  }),

  contractableAwards: authedQuery.query(async ({ ctx }) => {
    return getDb().select({
      awardId: awards.id,
      licitacionId: awards.licitacionId,
      lotId: awards.lotId,
      lotCode: procedureLots.code,
      lotTitle: procedureLots.title,
      proveedorId: awards.proveedorId,
      proveedor: proveedores.razonSocial,
      amount: awards.amount,
      currency: awards.currency,
      falloId: awards.falloId,
      publishedAt: awards.publishedAt,
    }).from(awards)
      .innerJoin(procedureLots, and(
        eq(procedureLots.tenantId, awards.tenantId),
        eq(procedureLots.id, awards.lotId),
      ))
      .innerJoin(proveedores, and(
        eq(proveedores.tenantId, awards.tenantId),
        eq(proveedores.id, awards.proveedorId),
      ))
      .leftJoin(contratos, and(
        eq(contratos.tenantId, awards.tenantId),
        eq(contratos.awardId, awards.id),
      ))
      .where(and(
        eq(awards.tenantId, ctx.user.tenantId),
        eq(awards.status, "PUBLISHED"),
        isNull(contratos.id),
      ))
      .orderBy(desc(awards.publishedAt));
  }),

  crear: procedureMutation({ capability: "formalizar_contrato", role: "creador", resolveLicitacionId: (i, ctx) => licitacionIdFromAward(i, ctx.user!.tenantId) }).input(z.object({
    awardId: z.number().int().positive(),
    folio: z.string().trim().min(3).max(80),
    objeto: z.string().trim().min(10).optional(),
    fechaInicio: dateMx.optional(),
    fechaFin: dateMx.optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const award = await db.query.awards.findFirst({ where: and(
      eq(awards.tenantId, ctx.user.tenantId),
      eq(awards.id, input.awardId),
      eq(awards.status, "PUBLISHED"),
    ) });
    if (!award || !award.falloId) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El contrato requiere una adjudicación PUBLICADA vinculada a fallo." });
    }
    const [lic, fallo, lot] = await Promise.all([
      assertLicitacionExists(ctx.user.tenantId, award.licitacionId),
      db.query.fallos.findFirst({ where: and(
        eq(fallos.tenantId, ctx.user.tenantId),
        eq(fallos.id, award.falloId),
        eq(fallos.licitacionId, award.licitacionId),
        eq(fallos.estado, "PUBLICADO"),
      ) }),
      db.query.procedureLots.findFirst({ where: and(
        eq(procedureLots.tenantId, ctx.user.tenantId),
        eq(procedureLots.id, award.lotId),
        eq(procedureLots.licitacionId, award.licitacionId),
        eq(procedureLots.status, "AWARDED"),
      ) }),
    ]);
    if (lic.estado !== "ADJUDICADA" || !fallo || !lot) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La adjudicación, el fallo y el lote deben estar publicados y resueltos." });
    }
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, award.licitacionId);
    if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin expediente." });
    let id = 0;
    await db.transaction(async (tx) => {
      const dup = await tx.query.contratos.findFirst({ where: and(eq(contratos.tenantId, ctx.user.tenantId), eq(contratos.awardId, input.awardId)) });
      if (dup) throw new TRPCError({ code: "CONFLICT", message: "La adjudicación ya tiene contrato." });
      const result = await tx.insert(contratos).values({
        tenantId: ctx.user.tenantId, expedienteId: expediente.id, licitacionId: award.licitacionId,
        falloId: fallo.id, awardId: award.id, proveedorId: award.proveedorId, folio: input.folio,
        estado: "BORRADOR", monto: award.amount, moneda: award.currency,
        objeto: input.objeto ?? `${lic.objeto} — ${lot.title}`,
        fechaInicio: input.fechaInicio ? asUtcDate(input.fechaInicio) : null,
        fechaFin: input.fechaFin ? asUtcDate(input.fechaFin) : null,
      });
      id = Number(result[0].insertId);
      await tx.update(licitaciones).set({ etapa: "CONTRATACION" }).where(and(eq(licitaciones.id, award.licitacionId), eq(licitaciones.tenantId, ctx.user.tenantId)));
      await appendExpedienteEvent(tx, ctx, { expedienteId: expediente.id, tipo: "CONTRATO_CREADO", estadoAnterior: null, estadoNuevo: "BORRADOR", motivo: input.motivo, payload: { contratoId: id, awardId: award.id, lotId: award.lotId, folio: input.folio } });
      const createdInTx = await tx.query.contratos.findFirst({ where: and(eq(contratos.id, id), eq(contratos.tenantId, ctx.user.tenantId)) });
      await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "contratos", entidadId: id, valorNuevo: createdInTx, motivo: input.motivo, tx });
    });
    return getDb().query.contratos.findFirst({ where: and(eq(contratos.id, id), eq(contratos.tenantId, ctx.user.tenantId)) });
  }),

  formalizar: procedureMutation({ capability: "formalizar_contrato", role: "creador", resolveLicitacionId: (i, ctx) => licitacionIdFromContrato(i, ctx.user!.tenantId) }).input(z.object({
    id: z.number().int().positive(),
    fechaFirma: dateMx,
    documentoContratoId: z.number().int().positive(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const current = await db.query.contratos.findFirst({ where: and(eq(contratos.id, input.id), eq(contratos.tenantId, ctx.user.tenantId)) });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
    if (!current.awardId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El contrato no está vinculado a una adjudicación canónica." });
    const award = await db.query.awards.findFirst({ where: and(
      eq(awards.tenantId, ctx.user.tenantId),
      eq(awards.id, current.awardId),
      eq(awards.status, "PUBLISHED"),
    ) });
    if (!award) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La adjudicación contractual no está PUBLICADA." });
    const doc = await db.query.documentos.findFirst({
      where: and(eq(documentos.id, input.documentoContratoId), eq(documentos.tenantId, ctx.user.tenantId), eq(documentos.esVersionVigente, true)),
    });
    assertDocumentoBoundToContext(doc, {
      tenantId: ctx.user.tenantId,
      expedienteId: current.expedienteId,
      licitacionId: current.licitacionId,
      lotId: award.lotId,
      proveedorId: current.proveedorId,
      expectedTipo: "CONTRATO",
    });
    const updated = await transition(ctx, input.id, "FORMALIZADO", input.motivo, {
      fechaFirma: asUtcDate(input.fechaFirma), formalizadoPor: ctx.user.id, documentoContratoId: input.documentoContratoId,
    }, {
      outbox: {
        eventType: "CONTRATO_FORMALIZADO",
        asunto: `Contrato formalizado ${current.folio}`,
        cuerpo: `Se formalizó el contrato ${current.folio}.`,
      },
    });
    return updated;
  }),

  ponerVigente: procedureMutation({ capability: "formalizar_contrato", role: "creador", resolveLicitacionId: (i, ctx) => licitacionIdFromContrato(i, ctx.user!.tenantId) }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const current = await db.query.contratos.findFirst({ where: and(eq(contratos.id, input.id), eq(contratos.tenantId, ctx.user.tenantId)) });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
    const gars = await db.query.garantias.findMany({
      where: and(eq(garantias.tenantId, ctx.user.tenantId), eq(garantias.contratoId, input.id)),
    });
    assertGarantiasRequeridasActivas(gars.map((g) => ({ estado: g.estado })));
    return transition(ctx, input.id, "VIGENTE", input.motivo, {});
  }),

  terminar: procedureMutation({ capability: "formalizar_contrato", role: "creador", resolveLicitacionId: (i, ctx) => licitacionIdFromContrato(i, ctx.user!.tenantId) }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "TERMINADO", input.motivo, {});
  }),

  rescindir: procedureMutation({ capability: "formalizar_contrato", role: "creador", resolveLicitacionId: (i, ctx) => licitacionIdFromContrato(i, ctx.user!.tenantId) }).input(z.object({
    id: z.number().int().positive(),
    causa: z.string().trim().min(10),
    resolucion: z.string().trim().min(10),
    documentoRescisionId: z.number().int().positive().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const current = await db.query.contratos.findFirst({ where: and(eq(contratos.id, input.id), eq(contratos.tenantId, ctx.user.tenantId)) });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
    if (input.documentoRescisionId) {
      const doc = await db.query.documentos.findFirst({
        where: and(eq(documentos.id, input.documentoRescisionId), eq(documentos.tenantId, ctx.user.tenantId)),
      });
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Documento de rescisión no encontrado." });
    }
    return transition(ctx, input.id, "RESCINDIDO", input.motivo, {
      causaRescision: input.causa,
      resolucionRescision: input.resolucion,
      documentoRescisionId: input.documentoRescisionId ?? null,
    }, {
      extraPayload: { causa: input.causa, resolucion: input.resolucion, documentoRescisionId: input.documentoRescisionId ?? null },
      outbox: {
        eventType: "CONTRATO_RESCINDIDO",
        asunto: `Contrato rescindido ${current.folio}`,
        cuerpo: `Rescisión: ${input.causa}`,
      },
    });
  }),
  /** BESA-lite: administrador del contrato + penas convencionales. */
  configurarBesa: procedureMutation({ capability: "formalizar_contrato", role: "creador", resolveLicitacionId: (i, ctx) => licitacionIdFromContrato(i, ctx.user!.tenantId) }).input(z.object({
    id: z.number().int().positive(),
    administradorContratoId: z.number().int().positive().nullable().optional(),
    penasConvencionales: z.array(z.object({
      concepto: z.string().trim().min(3),
      porcentaje: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      monto: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      fundamento: z.string().trim().min(3).optional(),
    })).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const current = await db.query.contratos.findFirst({ where: and(eq(contratos.id, input.id), eq(contratos.tenantId, ctx.user.tenantId)) });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
    const patch: Partial<typeof contratos.$inferInsert> = {
      administradorContratoId: input.administradorContratoId === undefined ? current.administradorContratoId : input.administradorContratoId,
      penasConvencionales: input.penasConvencionales === undefined ? current.penasConvencionales : input.penasConvencionales,
    };
    let updated: typeof current | undefined;
    await db.transaction(async (tx) => {
      await tx.update(contratos).set(patch).where(and(eq(contratos.id, input.id), eq(contratos.tenantId, ctx.user.tenantId)));
      updated = await tx.query.contratos.findFirst({ where: and(eq(contratos.id, input.id), eq(contratos.tenantId, ctx.user.tenantId)) });
      await writeAudit({ ctx: ctxForAudit(ctx), accion: "CONFIGURAR_BESA", entidad: "contratos", entidadId: input.id, valorAnterior: current, valorNuevo: updated, motivo: input.motivo, tx });
    });
    return updated;
  }),

});

type AuthenticatedContext = TrpcContext & { user: NonNullable<TrpcContext["user"]> };
type ContractTransitionOptions = {
  extraPayload?: Record<string, unknown>;
  outbox?: { eventType: OutboxEventType; asunto: string; cuerpo: string };
};

async function transition(
  ctx: AuthenticatedContext,
  id: number,
  next: ContratoEstado,
  motivo: string,
  patch: Partial<typeof contratos.$inferInsert>,
  options: ContractTransitionOptions = {},
) {
  const db = getDb();
  const current = await db.query.contratos.findFirst({ where: and(eq(contratos.id, id), eq(contratos.tenantId, ctx.user.tenantId)) });
  if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
  assertContratoTransition(current.estado, next);
  await db.transaction(async (tx) => {
    const result = await tx.update(contratos).set({ ...patch, estado: next }).where(and(eq(contratos.id, id), eq(contratos.tenantId, ctx.user.tenantId), eq(contratos.estado, current.estado)));
    if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "El contrato cambió de estado." });
    const valorNuevo = { ...current, ...patch, estado: next };
    await appendExpedienteEvent(tx, ctx, { expedienteId: current.expedienteId, tipo: `CONTRATO_${next}`, estadoAnterior: current.estado, estadoNuevo: next, motivo, payload: { contratoId: id, ...options.extraPayload } });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "TRANSICION", entidad: "contratos", entidadId: id, valorAnterior: current, valorNuevo, motivo, tx });
    if (options.outbox) {
      await enqueueOutbox(tx, {
        tenantId: ctx.user.tenantId,
        aggregateType: "contratos",
        aggregateId: current.id,
        eventType: options.outbox.eventType,
        payload: {
          contratoId: current.id,
          licitacionId: current.licitacionId,
          proveedorId: current.proveedorId,
          actorUserId: ctx.user.id,
          asunto: options.outbox.asunto,
          cuerpo: options.outbox.cuerpo,
          entidadRef: "contratos",
          entidadId: current.id,
        },
      });
    }
  });
  return db.query.contratos.findFirst({ where: and(eq(contratos.id, id), eq(contratos.tenantId, ctx.user.tenantId)) });
}
