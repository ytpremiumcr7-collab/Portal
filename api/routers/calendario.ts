import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, ctxForAudit } from "../middleware";
import { resolveCapabilities } from "../lib/capabilities";
import { assertProcedimientoAsignacion, hasActiveBreakGlass } from "../lib/sod";
import { getDb } from "../queries/connection";
import { calendarioActos } from "@db/schema";
import { assertLicitacionExists } from "../lib/domain";
import { writeAudit } from "../lib/security";

export const calendarioRouter = createRouter({
  list: authedQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    return getDb().query.calendarioActos.findMany({
      where: and(eq(calendarioActos.tenantId, ctx.user.tenantId), eq(calendarioActos.licitacionId, input.licitacionId)),
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
    // Freeze after PUBLICADA except active break_glass
    if (!["BORRADOR", "CONSULTAS"].includes(lic.estado)) {
      const bg = await hasActiveBreakGlass(ctx.user, {
        licitacionId: input.licitacionId,
        capability: hasAdminCal ? "administrar_calendario" : "crear_procedimiento",
      });
      if (!bg) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Calendario jurídico congelado tras PUBLICADA; requiere break_glass aprobado por otro usuario.",
        });
      }
    }
    if (new Date(input.ventanaFin) <= new Date(input.ventanaInicio)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "ventanaFin debe ser posterior a ventanaInicio." });
    }
    const db = getDb();
    const existing = await db.query.calendarioActos.findFirst({
      where: and(eq(calendarioActos.tenantId, ctx.user.tenantId), eq(calendarioActos.licitacionId, input.licitacionId), eq(calendarioActos.acto, input.acto)),
    });
    let id = 0;
    if (existing) {
      await db.update(calendarioActos).set({
        ventanaInicio: new Date(input.ventanaInicio), ventanaFin: new Date(input.ventanaFin), obligatorio: input.obligatorio,
      } as any).where(and(eq(calendarioActos.id, existing.id), eq(calendarioActos.tenantId, ctx.user.tenantId)));
      id = existing.id;
    } else {
      const result = await db.insert(calendarioActos).values({
        tenantId: ctx.user.tenantId, licitacionId: input.licitacionId, acto: input.acto,
        ventanaInicio: new Date(input.ventanaInicio), ventanaFin: new Date(input.ventanaFin), obligatorio: input.obligatorio,
      } as any);
      id = Number(result[0].insertId);
    }
    const row = await db.query.calendarioActos.findFirst({ where: and(eq(calendarioActos.id, id), eq(calendarioActos.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CONFIGURAR", entidad: "calendario_actos", entidadId: id, valorNuevo: row, motivo: input.motivo });
    return row;
  }),
});
