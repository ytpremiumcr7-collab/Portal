import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { procedimientoAsignaciones } from "@db/schema";

/** Procedure-level assignment roles (per licitación/procedimiento). */
export const PROCEDIMIENTO_ROLES = [
  "creador",
  "evaluador_tecnico",
  "evaluador_economico",
  "dictaminador",
  "autorizador_fallo",
  "investigar_sancion",
  "administrar_sancion",
  "presentar_pago",
  "aprobar_pago",
  "promovente",
  "resolver_inconformidad",
] as const;
export type ProcedimientoRole = typeof PROCEDIMIENTO_ROLES[number];

export function isProcedimientoRole(v: string): v is ProcedimientoRole {
  return (PROCEDIMIENTO_ROLES as readonly string[]).includes(v);
}

/** Default incompatible role pairs on the same procedimiento. */
export const DEFAULT_ROLE_INCOMPATIBILIDADES: Array<[ProcedimientoRole, ProcedimientoRole, string]> = [
  ["evaluador_tecnico", "autorizador_fallo", "Quien evalúa no autoriza el fallo."],
  ["evaluador_economico", "autorizador_fallo", "Quien evalúa no autoriza el fallo."],
  ["presentar_pago", "aprobar_pago", "Quien presenta un pago no lo aprueba."],
  ["investigar_sancion", "administrar_sancion", "Quien investiga no administra/emite la sanción."],
  ["promovente", "resolver_inconformidad", "El promovente no resuelve su propia inconformidad."],
];

/** Default capability-level incompatibility pairs (seed into capability_incompatibilidades). */
export const DEFAULT_CAPABILITY_INCOMPATIBILIDADES: Array<[string, string, string]> = [
  ["evaluar_tecnico", "autorizar_fallo", "Segregación: evaluar vs autorizar fallo."],
  ["evaluar_economico", "autorizar_fallo", "Segregación: evaluar vs autorizar fallo."],
  ["presentar_pago", "aprobar_pago", "Segregación: presentar vs aprobar pago."],
  ["investigar_sancion", "administrar_sancion", "Segregación: investigar vs administrar sanción."],
];

export function findRoleConflict(
  existingRolesForUser: readonly string[],
  newRole: string,
  pairs: Array<[string, string, string]> = DEFAULT_ROLE_INCOMPATIBILIDADES as any,
): { a: string; b: string; motivo: string } | null {
  for (const [a, b, motivo] of pairs) {
    if (newRole === a && existingRolesForUser.includes(b)) return { a, b, motivo };
    if (newRole === b && existingRolesForUser.includes(a)) return { a, b, motivo };
  }
  return null;
}

export function assertNoRoleConflict(
  existingRolesForUser: readonly string[],
  newRole: string,
  opts?: { override?: boolean; justification?: string },
) {
  const conflict = findRoleConflict(existingRolesForUser, newRole);
  if (!conflict) return;
  if (opts?.override) {
    if (!opts.justification || opts.justification.trim().length < 10) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Override de SoD requiere justificación (≥10 caracteres) registrada en expediente.",
      });
    }
    return;
  }
  throw new TRPCError({
    code: "FORBIDDEN",
    message: `Segregación de funciones en el procedimiento: «${conflict.a}» incompatible con «${conflict.b}». ${conflict.motivo}`,
  });
}

/** Capability-set conflict (tenant-wide soft SoD when granting caps). */
export function findCapabilityConflicts(
  caps: ReadonlySet<string>,
  pairs: Array<{ capabilityA: string; capabilityB: string; motivo?: string | null }>,
): Array<{ a: string; b: string; motivo: string }> {
  const out: Array<{ a: string; b: string; motivo: string }> = [];
  for (const row of pairs) {
    if (caps.has(row.capabilityA) && caps.has(row.capabilityB)) {
      out.push({ a: row.capabilityA, b: row.capabilityB, motivo: row.motivo ?? "incompatibles" });
    }
  }
  return out;
}

export type SodUser = {
  id: number;
  tenantId: number;
  role: string;
};

/**
 * Enforce procedure-level SoD assignment.
 * - Admin: full bypass (no assignment required). Override justification is persisted on grant
 *   (procedimiento_asignaciones.justificacion_override + expediente SOD_OVERRIDE_ASIGNACION).
 * - Non-admin: must hold `role` on `licitacionId` in procedimiento_asignaciones.
 * When `role` is an array, any one match is enough (OR).
 */
export async function assertProcedimientoAsignacion(
  user: SodUser,
  licitacionId: number,
  role: ProcedimientoRole | ProcedimientoRole[],
  opts?: { adminBypass?: boolean },
) {
  const adminBypass = opts?.adminBypass !== false;
  if (adminBypass && user.role === "admin") return;

  const roles = Array.isArray(role) ? role : [role];
  for (const r of roles) {
    if (!isProcedimientoRole(r)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Rol de procedimiento desconocido: ${r}` });
    }
  }

  const db = getDb();
  const rows = await db.query.procedimientoAsignaciones.findMany({
    where: and(
      eq(procedimientoAsignaciones.tenantId, user.tenantId),
      eq(procedimientoAsignaciones.licitacionId, licitacionId),
      eq(procedimientoAsignaciones.userId, user.id),
    ),
  });
  const held = new Set(rows.map((r) => r.rol));
  if (roles.some((r) => held.has(r))) return;

  throw new TRPCError({
    code: "FORBIDDEN",
    message: `Segregación de funciones: se requiere asignación de procedimiento (${roles.join(" | ")}) en la licitación ${licitacionId}.`,
  });
}

/** Pure helper for unit/governance tests — same logic without DB. */
export function evaluateProcedimientoAsignacion(input: {
  userRole: string;
  heldRoles: readonly string[];
  required: readonly string[];
  adminBypass?: boolean;
}): { ok: boolean; reason?: string } {
  if ((input.adminBypass !== false) && input.userRole === "admin") return { ok: true };
  if (input.required.some((r) => input.heldRoles.includes(r))) return { ok: true };
  return {
    ok: false,
    reason: `Se requiere asignación (${input.required.join(" | ")})`,
  };
}
