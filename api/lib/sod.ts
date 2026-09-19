import { TRPCError } from "@trpc/server";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { procedimientoAsignaciones, breakGlassGrants } from "@db/schema";

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

/** Map procedimiento role → capability used for break-glass scope checks. */
export function capabilityForProcedimientoRole(role: ProcedimientoRole): string | null {
  const map: Partial<Record<ProcedimientoRole, string>> = {
    evaluador_tecnico: "evaluar_tecnico",
    evaluador_economico: "evaluar_economico",
    dictaminador: "emitir_dictamen",
    autorizador_fallo: "autorizar_fallo",
    presentar_pago: "presentar_pago",
    aprobar_pago: "aprobar_pago",
    investigar_sancion: "investigar_sancion",
    administrar_sancion: "administrar_sancion",
    resolver_inconformidad: "resolver_inconformidad",
  };
  return map[role] ?? null;
}

export async function hasActiveBreakGlass(
  user: SodUser,
  opts: { licitacionId?: number; capability?: string },
): Promise<boolean> {
  const db = getDb();
  const now = new Date();
  const conditions = [
    eq(breakGlassGrants.tenantId, user.tenantId),
    eq(breakGlassGrants.userId, user.id),
    isNull(breakGlassGrants.revokedAt),
    gt(breakGlassGrants.validUntil, now),
  ];
  if (opts.capability) {
    conditions.push(
      or(
        eq(breakGlassGrants.capability, opts.capability),
        eq(breakGlassGrants.capability, "break_glass"),
      )!,
    );
  }
  const rows = await db.query.breakGlassGrants.findMany({
    where: and(...conditions),
  });
  if (!rows.length) return false;
  if (opts.licitacionId == null) return true;
  return rows.some(
    (r) => r.licitacionId == null || Number(r.licitacionId) === Number(opts.licitacionId),
  );
}

/**
 * Enforce procedure-level SoD assignment.
 * - Admin does NOT bypass by default (adminBypass removed).
 * - Active break_glass grant (time-bound, justified) may bypass assignment for scoped acts.
 * - Non-admin / ordinary admin: must hold `role` on `licitacionId` in procedimiento_asignaciones.
 * When `role` is an array, any one match is enough (OR).
 */
export async function assertProcedimientoAsignacion(
  user: SodUser,
  licitacionId: number,
  role: ProcedimientoRole | ProcedimientoRole[],
  opts?: { allowBreakGlass?: boolean },
) {
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

  if (opts?.allowBreakGlass !== false) {
    for (const r of roles) {
      const cap = capabilityForProcedimientoRole(r);
      if (await hasActiveBreakGlass(user, { licitacionId, capability: cap ?? "break_glass" })) {
        return;
      }
    }
    if (await hasActiveBreakGlass(user, { licitacionId, capability: "break_glass" })) {
      return;
    }
  }

  throw new TRPCError({
    code: "FORBIDDEN",
    message: `Segregación de funciones: se requiere asignación de procedimiento (${roles.join(" | ")}) en la licitación ${licitacionId}, o un break_glass vigente con justificación.`,
  });
}

/** Pure helper for unit/governance tests — same logic without DB. */
export function evaluateProcedimientoAsignacion(input: {
  userRole: string;
  heldRoles: readonly string[];
  required: readonly string[];
  /** @deprecated Admin no longer auto-bypasses. Kept for test migration; ignored when false/undefined. */
  adminBypass?: boolean;
  hasBreakGlass?: boolean;
}): { ok: boolean; reason?: string } {
  // Explicit adminBypass=true is rejected in production paths; tests may assert false.
  if (input.adminBypass === true) {
    return { ok: false, reason: "adminBypass eliminado: use break_glass o asignación" };
  }
  if (input.required.some((r) => input.heldRoles.includes(r))) return { ok: true };
  if (input.hasBreakGlass) return { ok: true };
  return {
    ok: false,
    reason: `Se requiere asignación (${input.required.join(" | ")}) o break_glass`,
  };
}
