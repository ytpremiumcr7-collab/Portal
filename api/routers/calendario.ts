import { z } from "zod";
import { and, eq, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, ctxForAudit } from "../middleware";
import { resolveCapabilities } from "../lib/capabilities";
import { assertProcedimientoAsignacion, hasActiveBreakGlass } from "../lib/sod";
import { getDb } from "../queries/connection";
import { calendarioActos, calendarioVersiones } from "@db/schema";
import { assertLicitacionExists } from "../lib/domain";
import { writeAudit } from "../lib/security";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";

export const calendarioRouter = createRouter({
  list: authedQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    return getDb().query.calendarioActos.findMany({
      where: and(eq(calendarioActos.tenantId, ctx.user.tenantId), eq(calendarioActos.licitacionId, input.licitacionId)),
    });
  }),

  listVersiones: authedQuery.input(z.object({ licitacionId: z.number().int().positive(), acto: z.string().trim().min(2).max(60).optional() })).query(async ({ input, ctx }) => {
    const conditions = [eq(calendarioVersiones.tenantId, ctx.user.tenantId), eq(calendarioVersiones.licitacionId, input.licitacionId)];
    if (input.acto) conditions.push(eq(calendarioVersiones.acto, input.acto));
    return getDb().query.calendarioVersiones.findMany({
      where: and(...conditions),
      orderBy: [desc(calendarioVersiones.version)],
    });
  }),

  configurar: authedQuery.input(z.object({
    licitacionId: z.number().int().positive(),
    acto: z.string().trim().min(2).max(60),
    ventanaInicio: z.string().datetime(),
    ventanaFin: z.string().datetime(),
    obligatorio: z.boolean().default(true),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const lic = await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    const caps = await resolveCapabilities(ctx.user);
    const hasAdminCal = caps.has("administrar_calendario");
    const hasCrear = caps.has("crear_procedimiento");
    if (!hasAdminCal && !hasCrear) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Se requiere administrar_calendario o crear_procedimiento + asignación creador." });
    }
    if (!hasAdminCal) {
      await assertProcedimientoAsignacion(ctx.user, input.licitacionId, "creador");
    }
    let breakGlassId: number | null = null;
    let approvedBy: number | null = null;
    const postPublicada = !["BORRADOR", "CONSULTAS"].includes(lic.estado);
    if (postPublicada) {
      const bgOk = await hasActiveBreakGlass(ctx.user, {
        licitacionId: input.licitacionId,
        capability: hasAdminCal ? "administrar_calendario" : "crear_procedimiento",
      });
      if (!bgOk) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Calendario jurídico congelado tras PUBLICADA; requiere break_glass aprobado por otro usuario.",
        });
      }
      // Metadata for version row — best-effort lookup of active grant
      const { breakGlassGrants } = await import("@db/schema");
      const { and: and2, eq: eq2, isNull, gt } = await import("drizzle-orm");
      const grants = await getDb().query.breakGlassGrants.findMany({
        where: and2(
          eq2(breakGlassGrants.tenantId, ctx.user.tenantId),
          eq2(breakGlassGrants.userId, ctx.user.id),
          eq2(breakGlassGrants.status, "APPROVED"),
          isNull(breakGlassGrants.revokedAt),
          gt(breakGlassGrants.validUntil, new Date()),
        ),
      });
      const g = grants[0];
      breakGlassId = g?.id ?? null;
      approvedBy = (g as any)?.approvedBy ?? null;
    }
    if (new Date(input.ventanaFin) <= new Date(input.ventanaInicio)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "ventanaFin debe ser posterior a ventanaInicio." });
    }
    const db = getDb();
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    const row = await db.transaction(async (tx) => {
      // Lock calendar row so concurrent recepción cannot race past a mid-edit window.
      const locked = await tx.select().from(calendarioActos)
        .where(and(eq(calendarioActos.tenantId, ctx.user.tenantId), eq(calendarioActos.licitacionId, input.licitacionId), eq(calendarioActos.acto, input.acto)))
        .for("update")
        .limit(1);
      const existing = locked[0] ?? null;
      let id = 0;
      const prev = existing ? { ...existing } : null;
      if (existing) {
        // After PUBLICADA never silent overwrite — always insert version history; update projection.
        await tx.update(calendarioActos).set({
          ventanaInicio: new Date(input.ventanaInicio),
          ventanaFin: new Date(input.ventanaFin),
          obligatorio: input.obligatorio,
        } as any).where(and(eq(calendarioActos.id, existing.id), eq(calendarioActos.tenantId, ctx.user.tenantId)));
        id = existing.id;
      } else {
        const result = await tx.insert(calendarioActos).values({
          tenantId: ctx.user.tenantId, licitacionId: input.licitacionId, acto: input.acto,
          ventanaInicio: new Date(input.ventanaInicio), ventanaFin: new Date(input.ventanaFin), obligatorio: input.obligatorio,
        } as any);
        id = Number(result[0].insertId);
      }
      const verRows = await tx.select({ m: sql<number>`coalesce(max(${calendarioVersiones.version}), 0)` })
        .from(calendarioVersiones)
        .where(and(eq(calendarioVersiones.tenantId, ctx.user.tenantId), eq(calendarioVersiones.calendarioActoId, id)));
      const nextVer = Number(verRows[0]?.m ?? 0) + 1;
      await tx.insert(calendarioVersiones).values({
        tenantId: ctx.user.tenantId,
        calendarioActoId: id,
        licitacionId: input.licitacionId,
        acto: input.acto,
        version: nextVer,
        ventanaInicio: new Date(input.ventanaInicio),
        ventanaFin: new Date(input.ventanaFin),
        obligatorio: input.obligatorio,
        motivo: input.motivo,
        changedBy: ctx.user.id,
        approvedBy,
        breakGlassId,
      } as any);
      if (expediente) {
        await appendExpedienteEvent(tx, ctx, {
          expedienteId: expediente.id,
          tipo: "CALENDARIO_ACTO_CAMBIADO",
          estadoAnterior: prev ? `${prev.ventanaInicio?.toISOString?.() ?? prev.ventanaInicio}` : null,
          estadoNuevo: input.ventanaInicio,
          motivo: input.motivo,
          payload: {
            calendarioActoId: id, acto: input.acto, version: nextVer,
            ventanaInicio: input.ventanaInicio, ventanaFin: input.ventanaFin,
            breakGlassId, approvedBy, changedBy: ctx.user.id,
          },
        });
      }
      const updated = await tx.query.calendarioActos.findFirst({ where: and(eq(calendarioActos.id, id), eq(calendarioActos.tenantId, ctx.user.tenantId)) });
      await writeAudit({
        ctx: ctxForAudit(ctx), accion: "CONFIGURAR", entidad: "calendario_actos", entidadId: id,
        valorAnterior: prev, valorNuevo: { ...updated, version: nextVer }, motivo: input.motivo, tx,
      });
      return updated;
    });
    return row;
  }),
});
