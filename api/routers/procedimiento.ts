import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, capabilityQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { procedimientoEventos, procedimientoPlazos } from "@db/schema";
import { findExpedienteByLicitacion } from "../lib/expediente";
import { writeAudit } from "../lib/security";
import { assertLicitacionExists } from "../lib/domain";

export const procedimientoRouter = createRouter({
  listEventos: authedQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    return getDb().query.procedimientoEventos.findMany({
      where: and(eq(procedimientoEventos.tenantId, ctx.user.tenantId), eq(procedimientoEventos.licitacionId, input.licitacionId)),
      orderBy: [desc(procedimientoEventos.createdAt)],
    });
  }),

  listPlazos: authedQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    return getDb().query.procedimientoPlazos.findMany({
      where: and(eq(procedimientoPlazos.tenantId, ctx.user.tenantId), eq(procedimientoPlazos.licitacionId, input.licitacionId)),
    });
  }),

  registrarEvento: capabilityQuery("crear_procedimiento").input(z.object({
    licitacionId: z.number().int().positive(),
    tipo: z.string().trim().min(2).max(80),
    estadoAnterior: z.string().trim().max(40).optional(),
    estadoNuevo: z.string().trim().max(40).optional(),
    plazoLimite: z.string().datetime().optional(),
    motivo: z.string().trim().min(3),
    payload: z.record(z.string(), z.unknown()).optional(),
  })).mutation(async ({ input, ctx }) => {
    await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    const db = getDb();
    const result = await db.insert(procedimientoEventos).values({
      tenantId: ctx.user.tenantId, licitacionId: input.licitacionId, expedienteId: expediente?.id ?? null,
      tipo: input.tipo, estadoAnterior: input.estadoAnterior ?? null, estadoNuevo: input.estadoNuevo ?? null,
      plazoLimite: input.plazoLimite ? new Date(input.plazoLimite) : null,
      actorUserId: ctx.user.id, motivo: input.motivo,
      payload: input.payload ? JSON.stringify(input.payload) : null,
    });
    const id = Number(result[0].insertId);
    const created = await db.query.procedimientoEventos.findFirst({ where: and(eq(procedimientoEventos.id, id), eq(procedimientoEventos.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "procedimiento_eventos", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  definirPlazo: capabilityQuery("crear_procedimiento").input(z.object({
    licitacionId: z.number().int().positive(),
    codigo: z.string().trim().min(2).max(60),
    nombre: z.string().trim().min(2).max(180),
    fechaLimite: z.string().datetime(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    const db = getDb();
    const result = await db.insert(procedimientoPlazos).values({
      tenantId: ctx.user.tenantId, licitacionId: input.licitacionId,
      codigo: input.codigo, nombre: input.nombre, fechaLimite: new Date(input.fechaLimite), cumplido: false,
    });
    const id = Number(result[0].insertId);
    return db.query.procedimientoPlazos.findFirst({ where: and(eq(procedimientoPlazos.id, id), eq(procedimientoPlazos.tenantId, ctx.user.tenantId)) });
  }),

  marcarPlazoCumplido: capabilityQuery("crear_procedimiento").input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cur = await db.query.procedimientoPlazos.findFirst({ where: and(eq(procedimientoPlazos.id, input.id), eq(procedimientoPlazos.tenantId, ctx.user.tenantId)) });
    if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Plazo no encontrado." });
    await db.update(procedimientoPlazos).set({ cumplido: true, cumplidoAt: new Date() }).where(and(eq(procedimientoPlazos.id, input.id), eq(procedimientoPlazos.tenantId, ctx.user.tenantId)));
    return db.query.procedimientoPlazos.findFirst({ where: and(eq(procedimientoPlazos.id, input.id), eq(procedimientoPlazos.tenantId, ctx.user.tenantId)) });
  }),

  estadoProcedimiento: authedQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const lic = await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    const db = getDb();
    const plazos = await db.query.procedimientoPlazos.findMany({ where: and(eq(procedimientoPlazos.tenantId, ctx.user.tenantId), eq(procedimientoPlazos.licitacionId, input.licitacionId)) });
    const vencidos = plazos.filter((p) => !p.cumplido && p.fechaLimite < new Date());
    return { estado: lic.estado, etapa: lic.etapa, plazos, plazosVencidos: vencidos.length };
  }),
});
