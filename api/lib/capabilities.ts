import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { userCapabilities, type Capability, CAPABILITIES } from "@db/schema";
import type { TrpcContext } from "../context";
import { findCapabilityConflicts } from "./sod";

export { CAPABILITIES, type Capability };

/**
 * Procedural capabilities that cannot be self-granted without a second approver.
 * Global capability alone is never enough for juridical acts — procedureMutation
 * also requires procedimiento_asignaciones or APPROVED break_glass.
 */
export const PROCEDURAL_CAPABILITIES: readonly Capability[] = [
  "crear_procedimiento",
  "publicar",
  "publicar_terminacion",
  "evaluar_tecnico",
  "evaluar_economico",
  "aprobar_juridico",
  "emitir_dictamen",
  "autorizar_fallo",
  "formalizar_contrato",
  "presentar_pago",
  "aprobar_pago",
  "investigar_sancion",
  "administrar_sancion",
  "administrar_ejecucion",
  "administrar_calendario",
  "resolver_inconformidad",
  "emitir_desempate",
] as const;

export function isProceduralCapability(cap: string): boolean {
  return (PROCEDURAL_CAPABILITIES as readonly string[]).includes(cap);
}

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
  // Narrow defaults — operational acts need explicit user_capabilities AND
  // procedimiento_asignaciones (or break_glass).
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
  const overrides = await getDb().query.userCapabilities.findMany({
    where: and(eq(userCapabilities.tenantId, user.tenantId), eq(userCapabilities.userId, user.id)),
  });
  const now = Date.now();
  for (const row of overrides) {
    const cap = row.capability as Capability;
    if (!CAPABILITIES.includes(cap)) continue;
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= now) continue;
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
