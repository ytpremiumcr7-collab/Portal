import { enqueueOutbox } from "../lib/outbox";
import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, capabilityQuery, proveedorQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { inconformidades, proveedores, participaciones } from "@db/schema";
import { assertInconformidadTransition } from "../lib/phase3-transitions";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";
import { assertLicitacionExists } from "../lib/domain";
import { writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";

/** Server-authoritative response deadline (calendar days). Client plazoRespuesta is ignored. */
const PLAZO_RESPUESTA_DIAS = 15;

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
    /** @deprecated Ignored — server sets plazoRespuesta. Kept for API compatibility. */
    plazoRespuesta: z.string().datetime().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    const db = getDb();

    // Authz: promoventeProveedorId must belong to the authenticated proveedor (admin may act for a verified provider).
    let promoventeProveedorId: number;
    if (ctx.user.role === "proveedor") {
      const own = await db.query.proveedores.findFirst({
        where: and(eq(proveedores.tenantId, ctx.user.tenantId), eq(proveedores.usuarioId, ctx.user.id), eq(proveedores.activo, true)),
      });
      if (!own) throw new TRPCError({ code: "FORBIDDEN", message: "Usuario proveedor sin expediente activo." });
      if (input.promoventeProveedorId != null && input.promoventeProveedorId !== own.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No puede presentar inconformidad en nombre de otro proveedor." });
      }
      promoventeProveedorId = own.id;
    } else if (ctx.user.role === "admin") {
      if (!input.promoventeProveedorId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "promoventeProveedorId requerido para admin." });
      }
      const target = await db.query.proveedores.findFirst({
        where: and(eq(proveedores.id, input.promoventeProveedorId), eq(proveedores.tenantId, ctx.user.tenantId), eq(proveedores.activo, true)),
      });
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Proveedor promovente no encontrado." });
      promoventeProveedorId = target.id;
    } else {
      throw new TRPCError({ code: "FORBIDDEN", message: "Sólo proveedores (o admin) pueden presentar inconformidades." });
    }

    // Participation gate: must have participated in the licitación when participaciones exist / always require participation.
    const participacion = await db.query.participaciones.findFirst({
      where: and(
        eq(participaciones.tenantId, ctx.user.tenantId),
        eq(participaciones.licitacionId, input.licitacionId),
        eq(participaciones.proveedorId, promoventeProveedorId),
      ),
    });
    if (!participacion) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El promovente debe haber participado en la licitación." });
    }

    const plazoRespuesta = new Date(Date.now() + PLAZO_RESPUESTA_DIAS * 24 * 60 * 60 * 1000);
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    let id = 0;
    await db.transaction(async (tx) => {
      const result = await tx.insert(inconformidades).values({
        tenantId: ctx.user.tenantId, licitacionId: input.licitacionId,
        promoventeProveedorId, promoventeNombre: input.promoventeNombre,
        actoImpugnado: input.actoImpugnado, argumentos: input.argumentos, evidencias: input.evidencias ?? null,
        folio: input.folio, estado: "PRESENTADA",
        plazoRespuesta,
      });
      id = Number(result[0].insertId);
      if (expediente) {
        await appendExpedienteEvent(tx, ctx, { expedienteId: expediente.id, tipo: "INCONFORMIDAD_PRESENTADA", estadoAnterior: null, estadoNuevo: "PRESENTADA", motivo: input.motivo, payload: { inconformidadId: id, acto: input.actoImpugnado } });
      }
    });
    const created = await db.query.inconformidades.findFirst({ where: and(eq(inconformidades.id, id), eq(inconformidades.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "inconformidades", entidadId: id, valorNuevo: created, motivo: input.motivo });
    await getDb().transaction(async (tx) => {
      await enqueueOutbox(tx, {
        tenantId: ctx.user.tenantId,
        aggregateType: "inconformidades",
        aggregateId: created!.id,
        eventType: "INCONFORMIDAD_PRESENTADA",
        payload: { inconformidadId: created!.id, licitacionId: created!.licitacionId, actorUserId: ctx.user.id, asunto: `Inconformidad ${created!.folio}`, cuerpo: "Inconformidad presentada", entidadRef: "inconformidades", entidadId: created!.id, proveedorId: created!.promoventeProveedorId },
      });
    });
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
