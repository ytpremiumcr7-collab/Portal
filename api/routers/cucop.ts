import { z } from "zod";
import { and, eq, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, capabilityQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { catalogoCucop, licitaciones } from "@db/schema";
import { assertLicitacionExists } from "../lib/domain";
import { writeAudit } from "../lib/security";

export const cucopRouter = createRouter({
  list: authedQuery.input(z.object({ q: z.string().trim().optional() }).optional()).query(async ({ input }) => {
    const db = getDb();
    if (input?.q) {
      return db.query.catalogoCucop.findMany({
        where: and(eq(catalogoCucop.activo, true), like(catalogoCucop.descripcion, `%${input.q}%`)),
        limit: 50,
      });
    }
    return db.query.catalogoCucop.findMany({ where: eq(catalogoCucop.activo, true), limit: 100 });
  }),

  vincularLicitacion: capabilityQuery("crear_procedimiento").input(z.object({
    licitacionId: z.number().int().positive(),
    cucopId: z.number().int().positive(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    const db = getDb();
    const code = await db.query.catalogoCucop.findFirst({ where: and(eq(catalogoCucop.id, input.cucopId), eq(catalogoCucop.activo, true)) });
    if (!code) throw new TRPCError({ code: "NOT_FOUND", message: "Código CUCoP no encontrado." });
    await db.update(licitaciones).set({ cucopId: input.cucopId } as any)
      .where(and(eq(licitaciones.id, input.licitacionId), eq(licitaciones.tenantId, ctx.user.tenantId)));
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "VINCULAR_CUCOP", entidad: "licitaciones", entidadId: input.licitacionId, motivo: input.motivo });
    return { licitacionId: input.licitacionId, cucop: code };
  }),
});
