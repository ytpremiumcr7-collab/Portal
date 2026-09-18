import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, capabilityQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import {
  modificacionesContractuales, ejecucionesContractuales, entregables, finiquitos, contratos, licitaciones,
} from "@db/schema";
import { assertModContratoTransition, assertEjecucionTransition } from "../lib/phase3-transitions";
import { appendExpedienteEvent } from "../lib/expediente";
import { assertNonNegativeDecimal, writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";

const money = z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Importe inválido.");
const dateMx = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");

async function contratoOrThrow(tenantId: number, id: number) {
  const c = await getDb().query.contratos.findFirst({ where: and(eq(contratos.id, id), eq(contratos.tenantId, tenantId)) });
  if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
  return c;
}

export const ejecucionRouter = createRouter({
  listModificaciones: authedQuery.input(z.object({ contratoId: z.number().int().positive().optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(modificacionesContractuales.tenantId, ctx.user.tenantId)];
    if (input?.contratoId) conditions.push(eq(modificacionesContractuales.contratoId, input.contratoId));
    const where = and(...conditions);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.modificacionesContractuales.findMany({ where, orderBy: [desc(modificacionesContractuales.createdAt)], limit: pageSize, offset }),
      db.select({ total: count() }).from(modificacionesContractuales).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  crearModificacion: capabilityQuery("administrar_ejecucion").input(z.object({
    contratoId: z.number().int().positive(),
    tipo: z.enum(["CONVENIO", "AMPLIACION", "REDUCCION", "PRORROGA", "REPROGRAMACION"]),
    folio: z.string().trim().min(3).max(80), justificacion: z.string().trim().min(10),
    montoDelta: money.optional(), diasProrroga: z.number().int().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const contrato = await contratoOrThrow(ctx.user.tenantId, input.contratoId);
    if (!["FORMALIZADO", "VIGENTE"].includes(contrato.estado)) throw new TRPCError({ code: "CONFLICT", message: "Contrato no admite modificaciones." });
    const db = getDb();
    let id = 0;
    await db.transaction(async (tx) => {
      const result = await tx.insert(modificacionesContractuales).values({
        tenantId: ctx.user.tenantId, contratoId: input.contratoId, tipo: input.tipo, folio: input.folio,
        justificacion: input.justificacion, montoDelta: input.montoDelta ?? null, diasProrroga: input.diasProrroga ?? null,
        estado: "BORRADOR", creadaPor: ctx.user.id,
      });
      id = Number(result[0].insertId);
      await appendExpedienteEvent(tx, ctx, { expedienteId: contrato.expedienteId, tipo: "MODIFICACION_CREADA", estadoAnterior: null, estadoNuevo: "BORRADOR", motivo: input.motivo, payload: { modificacionId: id, tipo: input.tipo } });
    });
    const created = await db.query.modificacionesContractuales.findFirst({ where: and(eq(modificacionesContractuales.id, id), eq(modificacionesContractuales.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "modificaciones_contractuales", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  transicionarModificacion: capabilityQuery("administrar_ejecucion").input(z.object({
    id: z.number().int().positive(),
    to: z.enum(["EN_REVISION", "APROBADA", "RECHAZADA", "FORMALIZADA"]),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cur = await db.query.modificacionesContractuales.findFirst({ where: and(eq(modificacionesContractuales.id, input.id), eq(modificacionesContractuales.tenantId, ctx.user.tenantId)) });
    if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Modificación no encontrada." });
    assertModContratoTransition(cur.estado as any, input.to);
    const contrato = await contratoOrThrow(ctx.user.tenantId, cur.contratoId);
    const patch: Record<string, unknown> = { estado: input.to };
    if (input.to === "APROBADA") { patch.aprobadaPor = ctx.user.id; patch.aprobadaAt = new Date(); }
    if (input.to === "FORMALIZADA") {
      patch.formalizadaAt = new Date();
      if (cur.montoDelta) {
        const nuevo = Number(contrato.monto) + Number(cur.montoDelta);
        if (nuevo < 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Monto resultante negativo." });
      }
    }
    await db.transaction(async (tx) => {
      await tx.update(modificacionesContractuales).set(patch as any).where(and(eq(modificacionesContractuales.id, input.id), eq(modificacionesContractuales.tenantId, ctx.user.tenantId), eq(modificacionesContractuales.estado, cur.estado)));
      if (input.to === "FORMALIZADA" && cur.montoDelta) {
        await tx.update(contratos).set({ monto: String(Number(contrato.monto) + Number(cur.montoDelta)) } as any)
          .where(and(eq(contratos.id, contrato.id), eq(contratos.tenantId, ctx.user.tenantId)));
      }
      await appendExpedienteEvent(tx, ctx, { expedienteId: contrato.expedienteId, tipo: `MODIFICACION_${input.to}`, estadoAnterior: cur.estado, estadoNuevo: input.to, motivo: input.motivo, payload: { modificacionId: input.id } });
    });
    return db.query.modificacionesContractuales.findFirst({ where: and(eq(modificacionesContractuales.id, input.id), eq(modificacionesContractuales.tenantId, ctx.user.tenantId)) });
  }),

  getEjecucion: authedQuery.input(z.object({ contratoId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    return getDb().query.ejecucionesContractuales.findFirst({
      where: and(eq(ejecucionesContractuales.tenantId, ctx.user.tenantId), eq(ejecucionesContractuales.contratoId, input.contratoId)),
      with: { entregables: true },
    });
  }),

  iniciarEjecucion: capabilityQuery("administrar_ejecucion").input(z.object({
    contratoId: z.number().int().positive(), fechaInicio: dateMx, motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const contrato = await contratoOrThrow(ctx.user.tenantId, input.contratoId);
    if (contrato.estado !== "VIGENTE") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El contrato debe estar VIGENTE." });
    const db = getDb();
    const existing = await db.query.ejecucionesContractuales.findFirst({ where: and(eq(ejecucionesContractuales.tenantId, ctx.user.tenantId), eq(ejecucionesContractuales.contratoId, input.contratoId)) });
    let id = existing?.id ?? 0;
    await db.transaction(async (tx) => {
      if (!existing) {
        const result = await tx.insert(ejecucionesContractuales).values({
          tenantId: ctx.user.tenantId, contratoId: input.contratoId, estado: "EN_EJECUCION", fechaInicio: input.fechaInicio as any, porcentajeAvance: "0.00",
        } as any);
        id = Number(result[0].insertId);
      } else {
        assertEjecucionTransition(existing.estado as any, "EN_EJECUCION");
        await tx.update(ejecucionesContractuales).set({ estado: "EN_EJECUCION", fechaInicio: input.fechaInicio as any } as any).where(and(eq(ejecucionesContractuales.id, existing.id), eq(ejecucionesContractuales.tenantId, ctx.user.tenantId)));
        id = existing.id;
      }
      await tx.update(licitaciones).set({ etapa: "EJECUCION" }).where(and(eq(licitaciones.id, contrato.licitacionId), eq(licitaciones.tenantId, ctx.user.tenantId)));
      await appendExpedienteEvent(tx, ctx, { expedienteId: contrato.expedienteId, tipo: "EJECUCION_INICIADA", estadoAnterior: existing?.estado ?? "NO_INICIADA", estadoNuevo: "EN_EJECUCION", motivo: input.motivo, payload: { ejecucionId: id } });
    });
    return db.query.ejecucionesContractuales.findFirst({ where: and(eq(ejecucionesContractuales.id, id), eq(ejecucionesContractuales.tenantId, ctx.user.tenantId)) });
  }),

  registrarAvance: capabilityQuery("administrar_ejecucion").input(z.object({
    contratoId: z.number().int().positive(), porcentajeAvance: z.number().min(0).max(100), motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const ejec = await db.query.ejecucionesContractuales.findFirst({ where: and(eq(ejecucionesContractuales.tenantId, ctx.user.tenantId), eq(ejecucionesContractuales.contratoId, input.contratoId)) });
    if (!ejec || ejec.estado !== "EN_EJECUCION") throw new TRPCError({ code: "CONFLICT", message: "Ejecución no está en curso." });
    const contrato = await contratoOrThrow(ctx.user.tenantId, input.contratoId);
    await db.transaction(async (tx) => {
      await tx.update(ejecucionesContractuales).set({ porcentajeAvance: String(input.porcentajeAvance) } as any).where(and(eq(ejecucionesContractuales.id, ejec.id), eq(ejecucionesContractuales.tenantId, ctx.user.tenantId)));
      await appendExpedienteEvent(tx, ctx, { expedienteId: contrato.expedienteId, tipo: "EJECUCION_AVANCE", estadoAnterior: ejec.estado, estadoNuevo: ejec.estado, motivo: input.motivo, payload: { porcentajeAvance: input.porcentajeAvance } });
    });
    return db.query.ejecucionesContractuales.findFirst({ where: and(eq(ejecucionesContractuales.id, ejec.id), eq(ejecucionesContractuales.tenantId, ctx.user.tenantId)) });
  }),

  transicionarEjecucion: capabilityQuery("administrar_ejecucion").input(z.object({
    contratoId: z.number().int().positive(),
    to: z.enum(["SUSPENDIDA", "EN_EJECUCION", "TERMINADA", "FINIQUITADA"]),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const ejec = await db.query.ejecucionesContractuales.findFirst({ where: and(eq(ejecucionesContractuales.tenantId, ctx.user.tenantId), eq(ejecucionesContractuales.contratoId, input.contratoId)) });
    if (!ejec) throw new TRPCError({ code: "NOT_FOUND", message: "Ejecución no encontrada." });
    assertEjecucionTransition(ejec.estado as any, input.to);
    const contrato = await contratoOrThrow(ctx.user.tenantId, input.contratoId);
    const patch: Record<string, unknown> = { estado: input.to };
    if (input.to === "TERMINADA") patch.fechaTerminacion = new Date().toISOString().slice(0, 10) as any;
    await db.transaction(async (tx) => {
      await tx.update(ejecucionesContractuales).set(patch as any).where(and(eq(ejecucionesContractuales.id, ejec.id), eq(ejecucionesContractuales.tenantId, ctx.user.tenantId)));
      await appendExpedienteEvent(tx, ctx, { expedienteId: contrato.expedienteId, tipo: `EJECUCION_${input.to}`, estadoAnterior: ejec.estado, estadoNuevo: input.to, motivo: input.motivo, payload: { ejecucionId: ejec.id } });
    });
    return db.query.ejecucionesContractuales.findFirst({ where: and(eq(ejecucionesContractuales.id, ejec.id), eq(ejecucionesContractuales.tenantId, ctx.user.tenantId)) });
  }),

  crearEntregable: capabilityQuery("administrar_ejecucion").input(z.object({
    contratoId: z.number().int().positive(), descripcion: z.string().trim().min(5),
    fechaProgramada: dateMx.optional(), motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const ejec = await db.query.ejecucionesContractuales.findFirst({ where: and(eq(ejecucionesContractuales.tenantId, ctx.user.tenantId), eq(ejecucionesContractuales.contratoId, input.contratoId)) });
    if (!ejec) throw new TRPCError({ code: "NOT_FOUND", message: "Inicie la ejecución primero." });
    const result = await db.insert(entregables).values({
      tenantId: ctx.user.tenantId, ejecucionId: ejec.id, contratoId: input.contratoId,
      descripcion: input.descripcion, fechaProgramada: (input.fechaProgramada ?? null) as any, estado: "PENDIENTE",
    } as any);
    const id = Number(result[0].insertId);
    return db.query.entregables.findFirst({ where: and(eq(entregables.id, id), eq(entregables.tenantId, ctx.user.tenantId)) });
  }),

  aceptarEntregable: capabilityQuery("administrar_ejecucion").input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cur = await db.query.entregables.findFirst({ where: and(eq(entregables.id, input.id), eq(entregables.tenantId, ctx.user.tenantId)) });
    if (!cur || !["PENDIENTE", "ENTREGADO"].includes(cur.estado)) throw new TRPCError({ code: "CONFLICT", message: "Entregable no aceptable." });
    const contrato = await contratoOrThrow(ctx.user.tenantId, cur.contratoId);
    await db.transaction(async (tx) => {
      await tx.update(entregables).set({ estado: "ACEPTADO", aceptadoPor: ctx.user.id, aceptadoAt: new Date() }).where(and(eq(entregables.id, input.id), eq(entregables.tenantId, ctx.user.tenantId)));
      await appendExpedienteEvent(tx, ctx, { expedienteId: contrato.expedienteId, tipo: "ENTREGABLE_ACEPTADO", estadoAnterior: cur.estado, estadoNuevo: "ACEPTADO", motivo: input.motivo, payload: { entregableId: input.id } });
    });
    return db.query.entregables.findFirst({ where: and(eq(entregables.id, input.id), eq(entregables.tenantId, ctx.user.tenantId)) });
  }),

  emitirFiniquito: capabilityQuery("administrar_ejecucion").input(z.object({
    contratoId: z.number().int().positive(), folio: z.string().trim().min(3).max(80),
    montoFinal: z.string().regex(/^\d+(\.\d{1,2})?$/), motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    assertNonNegativeDecimal(input.montoFinal, "montoFinal");
    const db = getDb();
    const ejec = await db.query.ejecucionesContractuales.findFirst({ where: and(eq(ejecucionesContractuales.tenantId, ctx.user.tenantId), eq(ejecucionesContractuales.contratoId, input.contratoId)) });
    if (!ejec || ejec.estado !== "TERMINADA") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La ejecución debe estar TERMINADA." });
    const contrato = await contratoOrThrow(ctx.user.tenantId, input.contratoId);
    let id = 0;
    await db.transaction(async (tx) => {
      const result = await tx.insert(finiquitos).values({
        tenantId: ctx.user.tenantId, contratoId: input.contratoId, ejecucionId: ejec.id,
        folio: input.folio, montoFinal: input.montoFinal, estado: "EMITIDO",
      });
      id = Number(result[0].insertId);
      assertEjecucionTransition("TERMINADA", "FINIQUITADA");
      await tx.update(ejecucionesContractuales).set({ estado: "FINIQUITADA" }).where(and(eq(ejecucionesContractuales.id, ejec.id), eq(ejecucionesContractuales.tenantId, ctx.user.tenantId)));
      await appendExpedienteEvent(tx, ctx, { expedienteId: contrato.expedienteId, tipo: "FINIQUITO_EMITIDO", estadoAnterior: "TERMINADA", estadoNuevo: "FINIQUITADA", motivo: input.motivo, payload: { finiquitoId: id } });
    });
    return db.query.finiquitos.findFirst({ where: and(eq(finiquitos.id, id), eq(finiquitos.tenantId, ctx.user.tenantId)) });
  }),
});
