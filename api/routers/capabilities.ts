import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { userCapabilities, CAPABILITIES, users } from "@db/schema";
import {
  resolveCapabilities, ROLE_CAPABILITIES, isCapability, assertCapabilityCompatibility,
  isProceduralCapability,
} from "../lib/capabilities";
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
    expiresAt: z.string().datetime().optional(),
    /** Second approver required for self-grant of procedural caps or SoD override. */
    approvedBy: z.number().int().positive().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    if (!isCapability(input.capability)) throw new TRPCError({ code: "BAD_REQUEST", message: "Capacidad desconocida." });
    const db = getDb();
    const user = await db.query.users.findFirst({ where: and(eq(users.id, input.userId), eq(users.tenantId, ctx.user.tenantId)) });
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado." });

    // FORBIDDEN: self-grant of procedural capabilities without second approver
    if (input.granted && input.userId === ctx.user.id && isProceduralCapability(input.capability)) {
      if (!input.approvedBy || input.approvedBy === ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `No puede auto-otorgarse la capacidad procedimental «${input.capability}»; se requiere segundo aprobador (approvedBy).`,
        });
      }
    }

    if (input.granted) {
      const effective = await resolveCapabilities(user);
      effective.add(input.capability as any);
      if (input.overrideSod) {
        if (!input.justificacionOverride || input.justificacionOverride.trim().length < 10) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Override de SoD requiere justificación (≥10 caracteres)." });
        }
        if (!input.approvedBy || input.approvedBy === ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Override de SoD en capabilities.grant requiere segundo aprobador (approvedBy ≠ otorgante).",
          });
        }
      } else {
        await assertCapabilityCompatibility(user, effective);
      }
    }

    const overrideFields = {
      overrideSod: input.overrideSod,
      justificacion: input.overrideSod ? (input.justificacionOverride ?? null) : null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      approvedBy: input.approvedBy ?? null,
      grantedBy: ctx.user.id,
      granted: input.granted,
    };

    const existing = await db.query.userCapabilities.findFirst({
      where: and(eq(userCapabilities.tenantId, ctx.user.tenantId), eq(userCapabilities.userId, input.userId), eq(userCapabilities.capability, input.capability)),
    });
    if (existing) {
      await db.update(userCapabilities).set(overrideFields as any)
        .where(and(eq(userCapabilities.id, existing.id), eq(userCapabilities.tenantId, ctx.user.tenantId)));
    } else {
      await db.insert(userCapabilities).values({
        tenantId: ctx.user.tenantId, userId: input.userId, capability: input.capability,
        ...overrideFields,
      } as any);
    }
    const row = await db.query.userCapabilities.findFirst({
      where: and(eq(userCapabilities.tenantId, ctx.user.tenantId), eq(userCapabilities.userId, input.userId), eq(userCapabilities.capability, input.capability)),
    });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: input.granted ? "GRANT_CAP" : "REVOKE_CAP", entidad: "user_capabilities", entidadId: row!.id, valorNuevo: row, motivo: input.motivo });
    return row;
  }),
});
