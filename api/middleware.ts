import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { assertCapability, type Capability } from "./lib/capabilities";

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
