import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { userCapabilities, type Capability, CAPABILITIES } from "@db/schema";
// Catalog (schema): crear_procedimiento, autorizar_fallo, presentar_pago, aprobar_pago,
// investigar_sancion, administrar_sancion, resolver_incidencia, auditar, …
import type { TrpcContext } from "../context";
import { findCapabilityConflicts } from "./sod";

export { CAPABILITIES, type Capability };

/**
 * Default capability grants by coarse role.
 * Admin always has all.
 * Licitante gets a SMALL base — ops capabilities are assigned deliberately
 * (user_capabilities and/or procedimiento_asignaciones). One-person orgs
 * can still grant both sides of an SoD pair with logged override.
 */
export const ROLE_CAPABILITIES: Record<"admin" | "licitante" | "proveedor", Capability[]> = {
  admin: [...CAPABILITIES],
  licitante: [
    "crear_procedimiento",
    "publicar",
    "administrar_planeacion",
    "investigar_mercado",
    "notificar",
  ],
  proveedor: ["presentar_pago", "notificar"],
};

export async function resolveCapabilities(user: NonNullable<TrpcContext["user"]>): Promise<Set<Capability>> {
  const base = new Set<Capability>(ROLE_CAPABILITIES[user.role] ?? []);
  if (user.role === "admin") return base;
  const overrides = await getDb().query.userCapabilities.findMany({
    where: and(eq(userCapabilities.tenantId, user.tenantId), eq(userCapabilities.userId, user.id)),
  });
  for (const row of overrides) {
    const cap = row.capability as Capability;
    if (!CAPABILITIES.includes(cap)) continue;
    if (row.granted) base.add(cap);
    else base.delete(cap);
  }
  return base;
}

export async function assertCapability(user: NonNullable<TrpcContext["user"]>, ...required: Capability[]) {
  const caps = await resolveCapabilities(user);
  for (const r of required) {
    if (!caps.has(r)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Se requiere la capacidad «${r}». Segregación de funciones: rol ${user.role} insuficiente.`,
      });
    }
  }
  return caps;
}

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** Enforce capability_incompatibilidades when a user holds both sides (no override). */
export async function assertCapabilityCompatibility(
  _user: NonNullable<TrpcContext["user"]>,
  caps: Set<Capability>,
  opts?: { allowOverride?: boolean },
) {
  try {
    const { capabilityIncompatibilidades } = await import("@db/schema");
    const rows = await getDb().select().from(capabilityIncompatibilidades).where(eq(capabilityIncompatibilidades.activa, true));
    const conflicts = findCapabilityConflicts(caps, rows.map((r) => ({
      capabilityA: r.capabilityA,
      capabilityB: r.capabilityB,
      motivo: r.motivo,
    })));
    if (conflicts.length && !opts?.allowOverride) {
      const c = conflicts[0];
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Segregación de funciones: «${c.a}» es incompatible con «${c.b}». ${c.motivo}`,
      });
    }
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    // Table may not exist yet — soft fail open only on infrastructure errors.
  }
}
