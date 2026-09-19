import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { userCapabilities, type Capability, CAPABILITIES } from "@db/schema";
import type { TrpcContext } from "../context";
import { findCapabilityConflicts } from "./sod";

export { CAPABILITIES, type Capability };
// Catalog (schema): crear_procedimiento, autorizar_fallo, presentar_pago, aprobar_pago,
// investigar_sancion, administrar_sancion, resolver_incidencia, auditar, break_glass, emitir_desempate, …


/**
 * Default capability grants by coarse role.
 * Admin manages users/config/assignments only — NOT procedural acts
 * (evaluar / autorizar_fallo / aprobar_pago). Those require explicit
 * user_capabilities and/or procedimiento_asignaciones / break_glass.
 */
export const ROLE_CAPABILITIES: Record<"admin" | "licitante" | "proveedor", Capability[]> = {
  admin: [
    "auditar",
    "notificar",
    "consulta_publica_admin",
    "break_glass",
  ],
  // Narrow defaults — operational acts (evaluar_*, autorizar_fallo, aprobar_pago, …)
  // need explicit user_capabilities AND procedimiento_asignaciones (or break_glass).
  // Do NOT restore full procedural caps here. Use sod.bootstrapAsignaciones for creador only.
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
  // Admin no longer auto-receives CAPABILITIES; overrides apply to all roles.
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
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "No se pudo verificar segregación de funciones (fallo de infraestructura). Operación denegada.",
      cause: e,
    });
  }
}
