import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, capabilityQuery, proveedorQuery, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import {
  consorcios, consorcioMiembros, proveedores, participaciones, proposiciones,
} from "@db/schema";
import { writeAudit } from "../lib/security";

async function ensureProviderForUser(tenantId: number, userId: number) {
  const provider = await getDb().query.proveedores.findFirst({
    where: and(eq(proveedores.tenantId, tenantId), eq(proveedores.usuarioId, userId), eq(proveedores.activo, true)),
  });
  if (!provider) throw new TRPCError({ code: "FORBIDDEN", message: "Sin expediente de proveedor activo." });
  return provider;
}

async function assertOwnsConsorcio(tenantId: number, consorcioId: number, userId: number, role: string) {
  const cons = await getDb().query.consorcios.findFirst({
    where: and(eq(consorcios.id, consorcioId), eq(consorcios.tenantId, tenantId)),
  });
  if (!cons) throw new TRPCError({ code: "NOT_FOUND", message: "Consorcio no encontrado." });
  if (role === "admin" || role === "licitante") return cons; // convocante may validate/link only
  if (Number(cons.creadoPor) !== Number(userId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sólo el proveedor creador administra este consorcio." });
  }
  return cons;
}

export const consorciosRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    if (ctx.user.role === "proveedor") {
      return db.query.consorcios.findMany({
        where: and(eq(consorcios.tenantId, ctx.user.tenantId), eq(consorcios.creadoPor, ctx.user.id)),
        orderBy: [desc(consorcios.id)],
      });
    }
    return db.query.consorcios.findMany({
      where: eq(consorcios.tenantId, ctx.user.tenantId),
      orderBy: [desc(consorcios.id)],
    });
  }),

  get: authedQuery.input(z.object({ id: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const db = getDb();
    const row = await db.query.consorcios.findFirst({
      where: and(eq(consorcios.id, input.id), eq(consorcios.tenantId, ctx.user.tenantId)),
    });
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Consorcio no encontrado." });
    if (ctx.user.role === "proveedor" && Number(row.creadoPor) !== Number(ctx.user.id)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Consorcio de otro proveedor." });
    }
    const miembros = await db.query.consorcioMiembros.findMany({
      where: and(eq(consorcioMiembros.tenantId, ctx.user.tenantId), eq(consorcioMiembros.consorcioId, input.id)),
    });
    return { ...row, miembros };
  }),

  /** Proveedor owns create. */
  crear: proveedorQuery.input(z.object({
    nombre: z.string().trim().min(3).max(200),
    rfcLider: z.string().trim().min(12).max(13).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    if (ctx.user.role !== "proveedor" && ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "El consorcio lo crea el proveedor (licitante)." });
    }
    if (ctx.user.role === "proveedor") await ensureProviderForUser(ctx.user.tenantId, ctx.user.id);
    const db = getDb();
    const result = await db.insert(consorcios).values({
      tenantId: ctx.user.tenantId,
      nombre: input.nombre,
      rfcLider: input.rfcLider ?? null,
      estado: "BORRADOR",
      creadoPor: ctx.user.id,
    } as any);
    const id = Number(result[0].insertId);
    const created = await db.query.consorcios.findFirst({
      where: and(eq(consorcios.id, id), eq(consorcios.tenantId, ctx.user.tenantId)),
    });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "consorcios", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  /** Proveedor owns add member. */
  agregarMiembro: proveedorQuery.input(z.object({
    consorcioId: z.number().int().positive(),
    proveedorId: z.number().int().positive(),
    rol: z.enum(["LIDER", "MIEMBRO"]).default("MIEMBRO"),
    porcentajeParticipacion: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const cons = await assertOwnsConsorcio(ctx.user.tenantId, input.consorcioId, ctx.user.id, ctx.user.role);
    if (cons.estado !== "BORRADOR") throw new TRPCError({ code: "CONFLICT", message: "Sólo se agregan miembros en BORRADOR." });
    const db = getDb();
    const prov = await db.query.proveedores.findFirst({
      where: and(eq(proveedores.id, input.proveedorId), eq(proveedores.tenantId, ctx.user.tenantId)),
    });
    if (!prov) throw new TRPCError({ code: "BAD_REQUEST", message: "Proveedor no válido." });
    const result = await db.insert(consorcioMiembros).values({
      tenantId: ctx.user.tenantId,
      consorcioId: input.consorcioId,
      proveedorId: input.proveedorId,
      rol: input.rol,
      porcentajeParticipacion: input.porcentajeParticipacion ?? null,
    } as any);
    const id = Number(result[0].insertId);
    const created = await db.query.consorcioMiembros.findFirst({
      where: and(eq(consorcioMiembros.id, id), eq(consorcioMiembros.tenantId, ctx.user.tenantId)),
    });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "AGREGAR_MIEMBRO", entidad: "consorcio_miembros", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  /** Proveedor owns activate. */
  activar: proveedorQuery.input(z.object({
    id: z.number().int().positive(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const current = await assertOwnsConsorcio(ctx.user.tenantId, input.id, ctx.user.id, ctx.user.role);
    const db = getDb();
    const miembros = await db.query.consorcioMiembros.findMany({
      where: and(eq(consorcioMiembros.tenantId, ctx.user.tenantId), eq(consorcioMiembros.consorcioId, input.id)),
    });
    if (miembros.length < 2) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Un consorcio activo requiere al menos dos miembros." });
    if (!miembros.some((m) => m.rol === "LIDER")) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Debe designarse un miembro con rol LIDER." });
    }
    await db.update(consorcios).set({ estado: "ACTIVO" } as any)
      .where(and(eq(consorcios.id, input.id), eq(consorcios.tenantId, ctx.user.tenantId)));
    const updated = await db.query.consorcios.findFirst({
      where: and(eq(consorcios.id, input.id), eq(consorcios.tenantId, ctx.user.tenantId)),
    });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "ACTIVAR", entidad: "consorcios", entidadId: input.id, valorAnterior: current, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),

  /** Convocante validates/links only — does not create/own. */
  vincularParticipacion: capabilityQuery("crear_procedimiento").input(z.object({
    consorcioId: z.number().int().positive(),
    participacionId: z.number().int().positive(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cons = await db.query.consorcios.findFirst({
      where: and(eq(consorcios.id, input.consorcioId), eq(consorcios.tenantId, ctx.user.tenantId)),
    });
    if (!cons || cons.estado !== "ACTIVO") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sólo un consorcio ACTIVO puede vincularse a una participación." });
    }
    const part = await db.query.participaciones.findFirst({
      where: and(eq(participaciones.id, input.participacionId), eq(participaciones.tenantId, ctx.user.tenantId)),
    });
    if (!part) throw new TRPCError({ code: "NOT_FOUND", message: "Participación no encontrada." });
    await db.update(participaciones).set({ consorcioId: input.consorcioId } as any)
      .where(and(eq(participaciones.id, input.participacionId), eq(participaciones.tenantId, ctx.user.tenantId)));
    const prop = await db.query.proposiciones.findFirst({
      where: and(eq(proposiciones.tenantId, ctx.user.tenantId), eq(proposiciones.participacionId, input.participacionId)),
    });
    if (prop) {
      await db.update(proposiciones).set({ consorcioId: input.consorcioId } as any)
        .where(and(eq(proposiciones.id, prop.id), eq(proposiciones.tenantId, ctx.user.tenantId)));
    }
    await writeAudit({
      ctx: ctxForAudit(ctx), accion: "VINCULAR_PARTICIPACION", entidad: "consorcios", entidadId: input.consorcioId,
      valorNuevo: { participacionId: input.participacionId, proposicionId: prop?.id ?? null }, motivo: input.motivo,
    });
    return { ok: true, participacionId: input.participacionId, proposicionId: prop?.id ?? null };
  }),
});
