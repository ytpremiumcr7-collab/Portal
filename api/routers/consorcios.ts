import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, convocanteQuery, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import {
  consorcios, consorcioMiembros, proveedores, participaciones, proposiciones,
} from "@db/schema";
import { writeAudit } from "../lib/security";

export const consorciosRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    return getDb().query.consorcios.findMany({
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
    const miembros = await db.query.consorcioMiembros.findMany({
      where: and(eq(consorcioMiembros.tenantId, ctx.user.tenantId), eq(consorcioMiembros.consorcioId, input.id)),
    });
    return { ...row, miembros };
  }),

  crear: convocanteQuery.input(z.object({
    nombre: z.string().trim().min(3).max(200),
    rfcLider: z.string().trim().min(12).max(13).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
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

  agregarMiembro: convocanteQuery.input(z.object({
    consorcioId: z.number().int().positive(),
    proveedorId: z.number().int().positive(),
    rol: z.enum(["LIDER", "MIEMBRO"]).default("MIEMBRO"),
    porcentajeParticipacion: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cons = await db.query.consorcios.findFirst({
      where: and(eq(consorcios.id, input.consorcioId), eq(consorcios.tenantId, ctx.user.tenantId)),
    });
    if (!cons) throw new TRPCError({ code: "NOT_FOUND", message: "Consorcio no encontrado." });
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

  activar: convocanteQuery.input(z.object({
    id: z.number().int().positive(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const current = await db.query.consorcios.findFirst({
      where: and(eq(consorcios.id, input.id), eq(consorcios.tenantId, ctx.user.tenantId)),
    });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Consorcio no encontrado." });
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

  /** Link consorcio to participación (and proposición if present). */
  vincularParticipacion: convocanteQuery.input(z.object({
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
