import { TRPCError } from "@trpc/server";

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
