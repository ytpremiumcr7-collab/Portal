import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, capabilityQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { notificaciones, notificacionDestinatarios, notificacionTemplates } from "@db/schema";
import { writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";

/** Official notification hooks for key acts. */
export const NOTIF_EVENTOS = [
  "FALLO_PUBLICADO", "ADJUDICACION", "CONTRATO_FORMALIZADO", "SANCION_EMITIDA", "INCONFORMIDAD_PRESENTADA", "INCONFORMIDAD_RESUELTA",
] as const;

export const notificacionesRouter = createRouter({
  list: authedQuery.input(z.object({ page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const where = eq(notificaciones.tenantId, ctx.user.tenantId);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.notificaciones.findMany({ where, orderBy: [desc(notificaciones.createdAt)], limit: pageSize, offset, with: { destinatarios: true } }),
      db.select({ total: count() }).from(notificaciones).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  listTemplates: authedQuery.query(async ({ ctx }) => {
    return getDb().query.notificacionTemplates.findMany({ where: and(eq(notificacionTemplates.tenantId, ctx.user.tenantId), eq(notificacionTemplates.activa, true)) });
  }),

  crearTemplate: capabilityQuery("notificar").input(z.object({
    codigo: z.string().trim().min(2).max(60), nombre: z.string().trim().min(2).max(160),
    asunto: z.string().trim().min(3).max(300), cuerpo: z.string().trim().min(10),
    efectoLegal: z.boolean().default(false), motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const result = await db.insert(notificacionTemplates).values({
      tenantId: ctx.user.tenantId, codigo: input.codigo, nombre: input.nombre,
      asunto: input.asunto, cuerpo: input.cuerpo, efectoLegal: input.efectoLegal, activa: true,
    });
    const id = Number(result[0].insertId);
    return db.query.notificacionTemplates.findFirst({ where: and(eq(notificacionTemplates.id, id), eq(notificacionTemplates.tenantId, ctx.user.tenantId)) });
  }),

  emitir: capabilityQuery("notificar").input(z.object({
    codigoEvento: z.enum(NOTIF_EVENTOS),
    templateId: z.number().int().positive().optional(),
    asunto: z.string().trim().min(3).max(300),
    cuerpo: z.string().trim().min(10),
    efectoLegal: z.boolean().default(false),
    entidadRef: z.string().trim().max(80).optional(),
    entidadId: z.number().int().positive().optional(),
    licitacionId: z.number().int().positive().optional(),
    destinatarios: z.array(z.object({
      email: z.string().email(),
      userId: z.number().int().positive().optional(),
      proveedorId: z.number().int().positive().optional(),
    })).min(1),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    let id = 0;
    await db.transaction(async (tx) => {
      const result = await tx.insert(notificaciones).values({
        tenantId: ctx.user.tenantId, templateId: input.templateId ?? null, codigoEvento: input.codigoEvento,
        asunto: input.asunto, cuerpo: input.cuerpo, efectoLegal: input.efectoLegal,
        entidadRef: input.entidadRef ?? null, entidadId: input.entidadId ?? null, licitacionId: input.licitacionId ?? null,
        estado: "ENVIADA", creadaPor: ctx.user.id, enviadaAt: new Date(),
      });
      id = Number(result[0].insertId);
      for (const d of input.destinatarios) {
        await tx.insert(notificacionDestinatarios).values({
          tenantId: ctx.user.tenantId, notificacionId: id, email: d.email,
          userId: d.userId ?? null, proveedorId: d.proveedorId ?? null, deliveryStatus: "ENVIADO",
        });
      }
    });
    const created = await db.query.notificaciones.findFirst({
      where: and(eq(notificaciones.id, id), eq(notificaciones.tenantId, ctx.user.tenantId)),
      with: { destinatarios: true },
    });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "EMITIR", entidad: "notificaciones", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  acknowledge: authedQuery.input(z.object({ destinatarioId: z.number().int().positive(), motivo: z.string().trim().min(3).optional() })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const dest = await db.query.notificacionDestinatarios.findFirst({
      where: and(eq(notificacionDestinatarios.id, input.destinatarioId), eq(notificacionDestinatarios.tenantId, ctx.user.tenantId)),
    });
    if (!dest) throw new TRPCError({ code: "NOT_FOUND", message: "Destinatario no encontrado." });
    await db.update(notificacionDestinatarios).set({ deliveryStatus: "ACKNOWLEDGED", acknowledgedAt: new Date() })
      .where(and(eq(notificacionDestinatarios.id, input.destinatarioId), eq(notificacionDestinatarios.tenantId, ctx.user.tenantId)));
    await db.update(notificaciones).set({ estado: "ACKNOWLEDGED" })
      .where(and(eq(notificaciones.id, dest.notificacionId), eq(notificaciones.tenantId, ctx.user.tenantId)));
    return db.query.notificacionDestinatarios.findFirst({ where: and(eq(notificacionDestinatarios.id, input.destinatarioId), eq(notificacionDestinatarios.tenantId, ctx.user.tenantId)) });
  }),
});
