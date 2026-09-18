import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, capabilityQuery, proveedorQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { inconformidades } from "@db/schema";
import { assertInconformidadTransition } from "../lib/phase3-transitions";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";
import { assertLicitacionExists } from "../lib/domain";
import { writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";

export const inconformidadesRouter = createRouter({
  list: authedQuery.input(z.object({ licitacionId: z.number().int().positive().optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(inconformidades.tenantId, ctx.user.tenantId)];
    if (input?.licitacionId) conditions.push(eq(inconformidades.licitacionId, input.licitacionId));
    const where = and(...conditions);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.inconformidades.findMany({ where, orderBy: [desc(inconformidades.createdAt)], limit: pageSize, offset }),
      db.select({ total: count() }).from(inconformidades).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  presentar: proveedorQuery.input(z.object({
    licitacionId: z.number().int().positive(),
    promoventeProveedorId: z.number().int().positive().optional(),
    promoventeNombre: z.string().trim().min(3).max(200),
    actoImpugnado: z.string().trim().min(3).max(200),
    argumentos: z.string().trim().min(20),
    evidencias: z.string().trim().optional(),
    folio: z.string().trim().min(3).max(80),
    plazoRespuesta: z.string().datetime().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    const db = getDb();
    let id = 0;
    await db.transaction(async (tx) => {
      const result = await tx.insert(inconformidades).values({
        tenantId: ctx.user.tenantId, licitacionId: input.licitacionId,
        promoventeProveedorId: input.promoventeProveedorId ?? null, promoventeNombre: input.promoventeNombre,
        actoImpugnado: input.actoImpugnado, argumentos: input.argumentos, evidencias: input.evidencias ?? null,
        folio: input.folio, estado: "PRESENTADA",
        plazoRespuesta: input.plazoRespuesta ? new Date(input.plazoRespuesta) : null,
      });
      id = Number(result[0].insertId);
      if (expediente) {
        await appendExpedienteEvent(tx, ctx, { expedienteId: expediente.id, tipo: "INCONFORMIDAD_PRESENTADA", estadoAnterior: null, estadoNuevo: "PRESENTADA", motivo: input.motivo, payload: { inconformidadId: id, acto: input.actoImpugnado } });
      }
    });
    const created = await db.query.inconformidades.findFirst({ where: and(eq(inconformidades.id, id), eq(inconformidades.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "inconformidades", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  transicionar: capabilityQuery("resolver_inconformidad").input(z.object({
    id: z.number().int().positive(),
    to: z.enum(["ADMITIDA", "EN_TRAMITE", "RESUELTA", "DESECHADA", "SOBRESEIDA"]),
    resolucion: z.string().trim().min(10).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cur = await db.query.inconformidades.findFirst({ where: and(eq(inconformidades.id, input.id), eq(inconformidades.tenantId, ctx.user.tenantId)) });
    if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Inconformidad no encontrada." });
    assertInconformidadTransition(cur.estado as any, input.to);
    if (input.to === "RESUELTA" && !input.resolucion) throw new TRPCError({ code: "BAD_REQUEST", message: "Resolución requerida." });
    const patch: Record<string, unknown> = { estado: input.to };
    if (input.resolucion) patch.resolucion = input.resolucion;
    if (["RESUELTA", "DESECHADA", "SOBRESEIDA"].includes(input.to)) {
      patch.resueltaPor = ctx.user.id; patch.resueltaAt = new Date();
    }
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, cur.licitacionId);
    await db.transaction(async (tx) => {
      await tx.update(inconformidades).set(patch as any).where(and(eq(inconformidades.id, input.id), eq(inconformidades.tenantId, ctx.user.tenantId), eq(inconformidades.estado, cur.estado)));
      if (expediente) {
        await appendExpedienteEvent(tx, ctx, { expedienteId: expediente.id, tipo: `INCONFORMIDAD_${input.to}`, estadoAnterior: cur.estado, estadoNuevo: input.to, motivo: input.motivo, payload: { inconformidadId: input.id } });
      }
    });
    const updated = await db.query.inconformidades.findFirst({ where: and(eq(inconformidades.id, input.id), eq(inconformidades.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "TRANSICION", entidad: "inconformidades", entidadId: input.id, valorAnterior: cur, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),
});
