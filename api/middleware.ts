import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { assertCapability, assertCapabilityCompatibility, type Capability } from "./lib/capabilities";
import {
  assertProcedimientoAsignacion,
  type ProcedimientoRole,
} from "./lib/sod";
import { assertInstitutionalProcedureAuthority } from "./lib/institutional-authority";

const t = initTRPC.context<TrpcContext>().create({ transformer: superjson });
export const createRouter = t.router;
export const publicQuery = t.procedure;

const requireAuth = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: ErrorMessages.unauthenticated });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

function requireRole(...roles: Array<NonNullable<TrpcContext["user"]>["role"]>) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.user || !roles.includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: ErrorMessages.insufficientRole });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

function requireCaps(...caps: Capability[]) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: ErrorMessages.unauthenticated });
    await assertCapability(ctx.user, ...caps);
    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

export const authedQuery = t.procedure.use(requireAuth);
export const adminQuery = authedQuery.use(requireRole("admin"));
export const convocanteQuery = authedQuery.use(requireRole("admin", "licitante"));
export const proveedorQuery = authedQuery.use(requireRole("admin", "proveedor"));
export const capabilityQuery = (...caps: Capability[]) => authedQuery.use(requireCaps(...caps));
export const ctxForAudit = (ctx: TrpcContext) => ({
  user: ctx.user!,
  ipAddress: ctx.ipAddress,
  userAgent: ctx.userAgent,
  requestId: ctx.requestId,
});

export type ProcedureMutationOpts = {
  /** Global capability (or any-of list) required in addition to procedure assignment. */
  capability: Capability | Capability[];
  /** Procedure role(s) — any match (OR). Alias: roles. */
  role?: ProcedimientoRole | ProcedimientoRole[];
  roles?: ProcedimientoRole | ProcedimientoRole[];
  /**
   * Resolve licitacionId from raw mutation input (and optionally ctx).
   * Required when role/roles is set — juridical acts cannot run on capability alone.
   */
  resolveLicitacionId?: (input: unknown, ctx: TrpcContext) => number | Promise<number>;
  /** When true, also run assertCapabilityCompatibility on the caller's effective set. */
  checkCompatibility?: boolean;
};

/**
 * Canonical procedure authority middleware.
 * Enforces in order: authenticated → tenant (via user) → assertCapability →
 * assertProcedimientoAsignacion (or active APPROVED break_glass by OTHER user) →
 * optional assertCapabilityCompatibility.
 *
 * Juridical mutations MUST use this (not bare capabilityQuery) when a procedure exists.
 */
export function procedureMutation(opts: ProcedureMutationOpts) {
  const caps = Array.isArray(opts.capability) ? opts.capability : [opts.capability];
  const rolesRaw = opts.roles ?? opts.role;
  const roles = rolesRaw == null ? null : Array.isArray(rolesRaw) ? rolesRaw : [rolesRaw];

  return authedQuery.use(async ({ ctx, getRawInput, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: ErrorMessages.unauthenticated });
    }
    if (!ctx.user.tenantId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Tenant requerido." });
    }

    // Capability list is OR: any one held is enough (callers may pass publicar | publicar_terminacion).
    let held: Awaited<ReturnType<typeof assertCapability>> | null = null;
    let lastErr: unknown = null;
    for (const c of caps) {
      try {
        held = await assertCapability(ctx.user, c);
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!held) {
      if (lastErr instanceof TRPCError) throw lastErr;
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Se requiere una de: ${caps.join(" | ")}.`,
      });
    }

    if (roles && roles.length) {
      if (!opts.resolveLicitacionId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "procedureMutation con role requiere resolveLicitacionId.",
        });
      }
      const raw = await getRawInput();
      const licitacionId = await opts.resolveLicitacionId(raw, ctx);
      if (!Number.isFinite(licitacionId) || licitacionId <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No se pudo resolver licitacionId para autoridad de procedimiento." });
      }
      await assertProcedimientoAsignacion(ctx.user, licitacionId, roles);
      await assertInstitutionalProcedureAuthority(ctx.user, licitacionId, roles);
    }

    if (opts.checkCompatibility) {
      await assertCapabilityCompatibility(ctx.user, held);
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}
