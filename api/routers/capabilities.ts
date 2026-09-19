import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { userCapabilities, CAPABILITIES, users, capabilityGrantRequests } from "@db/schema";
import {
  resolveCapabilities, ROLE_CAPABILITIES, isCapability, assertCapabilityCompatibility,
} from "../lib/capabilities";
import { writeAudit } from "../lib/security";

async function applyCapabilityGrant(
  db: ReturnType<typeof getDb>,
  ctx: any,
  input: {
    userId: number;
    capability: string;
    granted: boolean;
    overrideSod: boolean;
    justificacionOverride?: string | null;
    expiresAt?: Date | null;
    approvedBy: number;
    grantedBy: number;
    motivo: string;
  },
) {
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
  const overrideFields = {
    overrideSod: input.overrideSod,
    justificacion: input.overrideSod ? (input.justificacionOverride ?? null) : null,
    expiresAt: input.expiresAt ?? null,
    approvedBy: input.approvedBy,
    grantedBy: input.grantedBy,
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
}

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

  listGrantRequests: adminQuery.input(z.object({ status: z.enum(["PENDING","APPROVED","REJECTED","CANCELLED"]).optional() }).optional()).query(async ({ input, ctx }) => {
    const conditions = [eq(capabilityGrantRequests.tenantId, ctx.user.tenantId)];
    if (input?.status) conditions.push(eq(capabilityGrantRequests.status, input.status));
    return getDb().query.capabilityGrantRequests.findMany({ where: and(...conditions), orderBy: [desc(capabilityGrantRequests.createdAt)] });
  }),

  /**
   * P0-03: create PENDING grant request. Consent is only via approveGrant by a different session.
   */
  requestGrant: adminQuery.input(z.object({
    userId: z.number().int().positive(),
    capability: z.string().trim().min(2),
    granted: z.boolean().default(true),
    overrideSod: z.boolean().default(false),
    justificacionOverride: z.string().trim().min(10).optional(),
    expiresAt: z.string().datetime().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    if (!isCapability(input.capability)) throw new TRPCError({ code: "BAD_REQUEST", message: "Capacidad desconocida." });
    if (input.overrideSod && (!input.justificacionOverride || input.justificacionOverride.trim().length < 10)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Override de SoD requiere justificación (≥10 caracteres)." });
    }
    const db = getDb();
    const user = await db.query.users.findFirst({ where: and(eq(users.id, input.userId), eq(users.tenantId, ctx.user.tenantId)) });
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado." });
    const result = await db.insert(capabilityGrantRequests).values({
      tenantId: ctx.user.tenantId,
      userId: input.userId,
      capability: input.capability,
      granted: input.granted,
      overrideSod: input.overrideSod,
      justificacionOverride: input.overrideSod ? (input.justificacionOverride ?? null) : null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      status: "PENDING",
      requestedBy: ctx.user.id,
      motivo: input.motivo,
    } as any);
    const id = Number(result[0].insertId);
    await writeAudit({
      ctx: ctxForAudit(ctx), accion: "REQUEST_GRANT_CAP", entidad: "capability_grant_requests", entidadId: id,
      valorNuevo: { userId: input.userId, capability: input.capability, status: "PENDING" }, motivo: input.motivo,
    });
    return db.query.capabilityGrantRequests.findFirst({ where: and(eq(capabilityGrantRequests.id, id), eq(capabilityGrantRequests.tenantId, ctx.user.tenantId)) });
  }),

  approveGrant: adminQuery.input(z.object({
    id: z.number().int().positive(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const req = await db.query.capabilityGrantRequests.findFirst({
      where: and(eq(capabilityGrantRequests.id, input.id), eq(capabilityGrantRequests.tenantId, ctx.user.tenantId)),
    });
    if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Solicitud no encontrada." });
    if (req.status !== "PENDING") throw new TRPCError({ code: "CONFLICT", message: "Sólo se aprueban solicitudes PENDING." });
    if (ctx.user.id === Number(req.requestedBy) || ctx.user.id === Number(req.userId)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "El aprobador debe ser distinto del solicitante y del beneficiario (cuatro ojos).",
      });
    }
    await db.update(capabilityGrantRequests).set({
      status: "APPROVED", approvedBy: ctx.user.id, approvedAt: new Date(),
    } as any).where(and(eq(capabilityGrantRequests.id, input.id), eq(capabilityGrantRequests.tenantId, ctx.user.tenantId)));
    const row = await applyCapabilityGrant(db, ctx, {
      userId: req.userId,
      capability: req.capability,
      granted: !!req.granted,
      overrideSod: !!req.overrideSod,
      justificacionOverride: req.justificacionOverride,
      expiresAt: req.expiresAt,
      approvedBy: ctx.user.id,
      grantedBy: req.requestedBy,
      motivo: input.motivo,
    });
    await writeAudit({
      ctx: ctxForAudit(ctx), accion: "APPROVE_GRANT_CAP", entidad: "capability_grant_requests", entidadId: input.id,
      valorNuevo: { requestId: input.id, userCapabilityId: row!.id }, motivo: input.motivo,
    });
    return { request: await db.query.capabilityGrantRequests.findFirst({ where: and(eq(capabilityGrantRequests.id, input.id), eq(capabilityGrantRequests.tenantId, ctx.user.tenantId)) }), grant: row };
  }),

  /** @deprecated Use requestGrant → approveGrant. Direct grant with declarative approvedBy is forbidden. */
  grant: adminQuery.input(z.object({
    userId: z.number().int().positive(),
    capability: z.string().trim().min(2),
    granted: z.boolean().default(true),
    overrideSod: z.boolean().default(false),
    justificacionOverride: z.string().trim().min(10).optional(),
    expiresAt: z.string().datetime().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async () => {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "capabilities.grant directo está deshabilitado. Use requestGrant → approveGrant (cuatro ojos reales).",
    });
  }),
});
