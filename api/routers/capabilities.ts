import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { userCapabilities, CAPABILITIES, users } from "@db/schema";
import { resolveCapabilities, ROLE_CAPABILITIES, isCapability, assertCapabilityCompatibility } from "../lib/capabilities";
import { writeAudit } from "../lib/security";

export const capabilitiesRouter = createRouter({
  catalog: authedQuery.query(() => ({ capabilities: CAPABILITIES, roleDefaults: ROLE_CAPABILITIES })),

  listIncompatibilidades: authedQuery.query(async () => {
    const { capabilityIncompatibilidades } = await import("@db/schema");
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("../queries/connection");
    return getDb().select().from(capabilityIncompatibilidades).where(eq(capabilityIncompatibilidades.activa, true));
  }),

  mine: authedQuery.query(async ({ ctx }) => {
    const caps = await resolveCapabilities(ctx.user);
    return { role: ctx.user.role, capabilities: [...caps] };
  }),

  listForUser: adminQuery.input(z.object({ userId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const user = await getDb().query.users.findFirst({ where: and(eq(users.id, input.userId), eq(users.tenantId, ctx.user.tenantId)) });
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado." });
    const overrides = await getDb().query.userCapabilities.findMany({
      where: and(eq(userCapabilities.tenantId, ctx.user.tenantId), eq(userCapabilities.userId, input.userId)),
    });
    const effective = await resolveCapabilities(user);
    return { user, overrides, effective: [...effective] };
  }),

  grant: adminQuery.input(z.object({
    userId: z.number().int().positive(),
    capability: z.string().trim().min(2),
    granted: z.boolean().default(true),
    overrideSod: z.boolean().default(false),
    justificacionOverride: z.string().trim().min(10).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    if (!isCapability(input.capability)) throw new TRPCError({ code: "BAD_REQUEST", message: "Capacidad desconocida." });
    const db = getDb();
    const user = await db.query.users.findFirst({ where: and(eq(users.id, input.userId), eq(users.tenantId, ctx.user.tenantId)) });
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado." });
    if (input.granted) {
      const effective = await resolveCapabilities(user);
      effective.add(input.capability as any);
      if (input.overrideSod) {
        if (!input.justificacionOverride || input.justificacionOverride.trim().length < 10) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Override de SoD requiere justificación (≥10 caracteres)." });
        }
      } else {
        await assertCapabilityCompatibility(user, effective);
      }
    }
    const existing = await db.query.userCapabilities.findFirst({
      where: and(eq(userCapabilities.tenantId, ctx.user.tenantId), eq(userCapabilities.userId, input.userId), eq(userCapabilities.capability, input.capability)),
    });
    if (existing) {
      await db.update(userCapabilities).set({ granted: input.granted, grantedBy: ctx.user.id })
        .where(and(eq(userCapabilities.id, existing.id), eq(userCapabilities.tenantId, ctx.user.tenantId)));
    } else {
      await db.insert(userCapabilities).values({
        tenantId: ctx.user.tenantId, userId: input.userId, capability: input.capability,
        granted: input.granted, grantedBy: ctx.user.id,
      });
    }
    const row = await db.query.userCapabilities.findFirst({
      where: and(eq(userCapabilities.tenantId, ctx.user.tenantId), eq(userCapabilities.userId, input.userId), eq(userCapabilities.capability, input.capability)),
    });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: input.granted ? "GRANT_CAP" : "REVOKE_CAP", entidad: "user_capabilities", entidadId: row!.id, valorNuevo: row, motivo: input.motivo });
    return row;
  }),
});
