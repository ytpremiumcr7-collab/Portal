import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, capabilityQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { investigacionesMercado, proveedoresConsultados, cotizacionesMercado } from "@db/schema";
import { assertInvMercadoTransition } from "../lib/phase3-transitions";
import { assertNonNegativeDecimal, writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Importe inválido.");

export const investigacionMercadoRouter = createRouter({
  list: authedQuery.input(z.object({ page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const where = eq(investigacionesMercado.tenantId, ctx.user.tenantId);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.investigacionesMercado.findMany({ where, orderBy: [desc(investigacionesMercado.createdAt)], limit: pageSize, offset }),
      db.select({ total: count() }).from(investigacionesMercado).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  getById: authedQuery.input(z.object({ id: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const item = await getDb().query.investigacionesMercado.findFirst({
      where: and(eq(investigacionesMercado.id, input.id), eq(investigacionesMercado.tenantId, ctx.user.tenantId)),
      with: { consultados: { with: { cotizaciones: true } }, cotizaciones: true },
    });
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Investigación no encontrada." });
    return item;
  }),

  crear: capabilityQuery("investigar_mercado").input(z.object({
    folio: z.string().trim().min(3).max(60), objeto: z.string().trim().min(10),
    necesidadId: z.number().int().positive().optional(), licitacionId: z.number().int().positive().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const result = await db.insert(investigacionesMercado).values({
      tenantId: ctx.user.tenantId, folio: input.folio, objeto: input.objeto, estado: "BORRADOR",
      necesidadId: input.necesidadId ?? null, licitacionId: input.licitacionId ?? null, creadaPor: ctx.user.id,
    });
    const id = Number(result[0].insertId);
    const created = await db.query.investigacionesMercado.findFirst({ where: and(eq(investigacionesMercado.id, id), eq(investigacionesMercado.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "investigaciones_mercado", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  transicionar: capabilityQuery("investigar_mercado").input(z.object({
    id: z.number().int().positive(),
    to: z.enum(["EN_CONSULTA", "CERRADA", "CONCLUIDA", "CANCELADA"]),
    resultado: z.string().trim().min(5).optional(),
    conclusion: z.string().trim().min(5).optional(),
    precioReferencia: money.optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cur = await db.query.investigacionesMercado.findFirst({ where: and(eq(investigacionesMercado.id, input.id), eq(investigacionesMercado.tenantId, ctx.user.tenantId)) });
    if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Investigación no encontrada." });
    assertInvMercadoTransition(cur.estado as any, input.to);
    const patch: Record<string, unknown> = { estado: input.to };
    if (input.resultado) patch.resultado = input.resultado;
    if (input.conclusion) patch.conclusion = input.conclusion;
    if (input.precioReferencia) { assertNonNegativeDecimal(input.precioReferencia, "precioReferencia"); patch.precioReferencia = input.precioReferencia; }
    if (input.to === "CONCLUIDA") patch.concluidaAt = new Date();
    await db.update(investigacionesMercado).set(patch as any).where(and(eq(investigacionesMercado.id, input.id), eq(investigacionesMercado.tenantId, ctx.user.tenantId), eq(investigacionesMercado.estado, cur.estado)));
    return db.query.investigacionesMercado.findFirst({ where: and(eq(investigacionesMercado.id, input.id), eq(investigacionesMercado.tenantId, ctx.user.tenantId)) });
  }),

  consultarProveedor: capabilityQuery("investigar_mercado").input(z.object({
    investigacionId: z.number().int().positive(),
    proveedorId: z.number().int().positive().optional(),
    razonSocialExterna: z.string().trim().min(2).max(200).optional(),
    fuente: z.string().trim().min(2).max(200).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const inv = await db.query.investigacionesMercado.findFirst({ where: and(eq(investigacionesMercado.id, input.investigacionId), eq(investigacionesMercado.tenantId, ctx.user.tenantId)) });
    if (!inv || !["BORRADOR", "EN_CONSULTA"].includes(inv.estado)) throw new TRPCError({ code: "CONFLICT", message: "Investigación no admite consultas." });
    if (!input.proveedorId && !input.razonSocialExterna) throw new TRPCError({ code: "BAD_REQUEST", message: "Indique proveedor o razón social externa." });
    const result = await db.insert(proveedoresConsultados).values({
      tenantId: ctx.user.tenantId, investigacionId: input.investigacionId,
      proveedorId: input.proveedorId ?? null, razonSocialExterna: input.razonSocialExterna ?? null, fuente: input.fuente ?? null,
    });
    const id = Number(result[0].insertId);
    if (inv.estado === "BORRADOR") {
      assertInvMercadoTransition("BORRADOR", "EN_CONSULTA");
      await db.update(investigacionesMercado).set({ estado: "EN_CONSULTA" }).where(and(eq(investigacionesMercado.id, inv.id), eq(investigacionesMercado.tenantId, ctx.user.tenantId)));
    }
    return db.query.proveedoresConsultados.findFirst({ where: and(eq(proveedoresConsultados.id, id), eq(proveedoresConsultados.tenantId, ctx.user.tenantId)) });
  }),

  registrarCotizacion: capabilityQuery("investigar_mercado").input(z.object({
    investigacionId: z.number().int().positive(),
    proveedorConsultadoId: z.number().int().positive(),
    monto: money, observaciones: z.string().trim().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    assertNonNegativeDecimal(input.monto, "monto");
    const db = getDb();
    const inv = await db.query.investigacionesMercado.findFirst({ where: and(eq(investigacionesMercado.id, input.investigacionId), eq(investigacionesMercado.tenantId, ctx.user.tenantId)) });
    if (!inv || inv.estado !== "EN_CONSULTA") throw new TRPCError({ code: "CONFLICT", message: "Sólo en consulta se registran cotizaciones (≠ oferta de participación)." });
    const result = await db.insert(cotizacionesMercado).values({
      tenantId: ctx.user.tenantId, investigacionId: input.investigacionId,
      proveedorConsultadoId: input.proveedorConsultadoId, monto: input.monto, moneda: "MXN",
      observaciones: input.observaciones ?? null, estado: "RECIBIDA",
    } as any);
    const id = Number(result[0].insertId);
    return db.query.cotizacionesMercado.findFirst({ where: and(eq(cotizacionesMercado.id, id), eq(cotizacionesMercado.tenantId, ctx.user.tenantId)) });
  }),

  comparativo: authedQuery.input(z.object({ investigacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const db = getDb();
    const cotizaciones = await db.query.cotizacionesMercado.findMany({
      where: and(eq(cotizacionesMercado.tenantId, ctx.user.tenantId), eq(cotizacionesMercado.investigacionId, input.investigacionId)),
      orderBy: [desc(cotizacionesMercado.monto)],
    });
    const montos = cotizaciones.map((c) => Number(c.monto)).filter((n) => Number.isFinite(n));
    const min = montos.length ? Math.min(...montos) : null;
    const max = montos.length ? Math.max(...montos) : null;
    const avg = montos.length ? montos.reduce((a, b) => a + b, 0) / montos.length : null;
    return { cotizaciones, min, max, avg, count: montos.length };
  }),
});
