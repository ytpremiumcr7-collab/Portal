import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, capabilityQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { incidencias, contratos, licitaciones, proveedores, users } from "@db/schema";
import { assertIncidenciaTransition } from "../lib/phase3-transitions";
import { appendExpedienteEvent } from "../lib/expediente";
import { writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";

export const incidenciasRouter = createRouter({
  list: authedQuery.input(z.object({ contratoId: z.number().int().positive().optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(incidencias.tenantId, ctx.user.tenantId)];
    if (input?.contratoId) conditions.push(eq(incidencias.contratoId, input.contratoId));
    const where = and(...conditions);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.incidencias.findMany({ where, orderBy: [desc(incidencias.createdAt)], limit: pageSize, offset }),
      db.select({ total: count() }).from(incidencias).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  reportar: capabilityQuery("resolver_incidencia").input(z.object({
    contratoId: z.number().int().positive().optional(),
    licitacionId: z.number().int().positive().optional(),
    proveedorId: z.number().int().positive().optional(),
    tipo: z.enum(["INCUMPLIMIENTO", "OBSERVACION", "RETRASO", "CALIDAD", "OTRO"]),
    titulo: z.string().trim().min(3).max(200),
    descripcion: z.string().trim().min(10),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    let expedienteId: number | null = null;
    let licitacionId = input.licitacionId ?? null;
    let proveedorId = input.proveedorId ?? null;
    if (input.contratoId) {
      const c = await db.query.contratos.findFirst({ where: and(eq(contratos.id, input.contratoId), eq(contratos.tenantId, ctx.user.tenantId)) });
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
      expedienteId = c.expedienteId;
      // Aggregate consistency: contrato → licitacion / proveedor
      if (licitacionId != null && Number(licitacionId) !== Number(c.licitacionId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "licitacionId no coincide con el contrato." });
      }
      if (proveedorId != null && Number(proveedorId) !== Number(c.proveedorId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "proveedorId no coincide con el contrato." });
      }
      licitacionId = c.licitacionId;
      proveedorId = c.proveedorId;
    } else {
      if (licitacionId != null) {
        const lic = await db.query.licitaciones.findFirst({ where: and(eq(licitaciones.id, licitacionId), eq(licitaciones.tenantId, ctx.user.tenantId)) });
        if (!lic) throw new TRPCError({ code: "NOT_FOUND", message: "Licitación no encontrada." });
      }
      if (proveedorId != null) {
        const prov = await db.query.proveedores.findFirst({ where: and(eq(proveedores.id, proveedorId), eq(proveedores.tenantId, ctx.user.tenantId)) });
        if (!prov) throw new TRPCError({ code: "NOT_FOUND", message: "Proveedor no encontrado." });
      }
    }
    let id = 0;
    await db.transaction(async (tx) => {
      const result = await tx.insert(incidencias).values({
        tenantId: ctx.user.tenantId, contratoId: input.contratoId ?? null, licitacionId,
        proveedorId, tipo: input.tipo, titulo: input.titulo, descripcion: input.descripcion,
        estado: "ABIERTA", reportadaPor: ctx.user.id,
      });
      id = Number(result[0].insertId);
      if (expedienteId) {
        await appendExpedienteEvent(tx, ctx, { expedienteId, tipo: "INCIDENCIA_ABIERTA", estadoAnterior: null, estadoNuevo: "ABIERTA", motivo: input.motivo, payload: { incidenciaId: id, tipo: input.tipo } });
      }
    });
    const created = await db.query.incidencias.findFirst({ where: and(eq(incidencias.id, id), eq(incidencias.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "incidencias", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  transicionar: capabilityQuery("resolver_incidencia").input(z.object({
    id: z.number().int().positive(),
    to: z.enum(["EN_ANALISIS", "ACCION_CORRECTIVA", "RESUELTA", "ESCALADA", "CERRADA"]),
    accionCorrectiva: z.string().trim().min(5).optional(),
    asignadaA: z.number().int().positive().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cur = await db.query.incidencias.findFirst({ where: and(eq(incidencias.id, input.id), eq(incidencias.tenantId, ctx.user.tenantId)) });
    if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Incidencia no encontrada." });
    assertIncidenciaTransition(cur.estado as any, input.to);
    const patch: Record<string, unknown> = { estado: input.to };
    if (input.accionCorrectiva) patch.accionCorrectiva = input.accionCorrectiva;
    if (input.asignadaA) {
      const assignee = await db.query.users.findFirst({ where: and(eq(users.id, input.asignadaA), eq(users.tenantId, ctx.user.tenantId), eq(users.activo, true)) });
      if (!assignee) throw new TRPCError({ code: "BAD_REQUEST", message: "asignadaA debe ser un usuario activo del tenant." });
      patch.asignadaA = input.asignadaA;
    }
    if (input.to === "RESUELTA" || input.to === "CERRADA") patch.resueltaAt = new Date();
    let expedienteId: number | null = null;
    if (cur.contratoId) {
      const c = await db.query.contratos.findFirst({ where: and(eq(contratos.id, cur.contratoId), eq(contratos.tenantId, ctx.user.tenantId)) });
      expedienteId = c?.expedienteId ?? null;
    }
    await db.transaction(async (tx) => {
      await tx.update(incidencias).set(patch as any).where(and(eq(incidencias.id, input.id), eq(incidencias.tenantId, ctx.user.tenantId), eq(incidencias.estado, cur.estado)));
      if (expedienteId) {
        await appendExpedienteEvent(tx, ctx, { expedienteId, tipo: `INCIDENCIA_${input.to}`, estadoAnterior: cur.estado, estadoNuevo: input.to, motivo: input.motivo, payload: { incidenciaId: input.id } });
      }
    });
    const updated = await db.query.incidencias.findFirst({ where: and(eq(incidencias.id, input.id), eq(incidencias.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "TRANSICION", entidad: "incidencias", entidadId: input.id, valorAnterior: cur, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),
});
