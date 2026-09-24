import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { licitaciones } from "@db/schema";
import { authorityDelegations, organizationalUnitMemberships } from "@db/schema-eproc";
import { getDb } from "../queries/connection";
import { evaluateInstitutionalAuthority, type InstitutionalRole } from "./eproc-core";

const ROLE_MAP: Record<string, InstitutionalRole> = {
  creador: "OPERADOR",
  evaluador_tecnico: "TECNICO",
  evaluador_economico: "TECNICO",
  dictaminador: "JURIDICO",
  autorizador_fallo: "APROBADOR",
  investigar_sancion: "JURIDICO",
  administrar_sancion: "APROBADOR",
  presentar_pago: "OPERADOR",
  aprobar_pago: "PRESUPUESTO",
  promovente: "OPERADOR",
  resolver_inconformidad: "JURIDICO",
  administrar_ejecucion: "ADMIN_CONTRATO",
};

export function institutionalRolesForProcedureRoles(roles: readonly string[]): InstitutionalRole[] {
  return [...new Set(roles.map((r) => ROLE_MAP[r]).filter((r): r is InstitutionalRole => !!r))];
}

export type AuthoritySnapshotInput = {
  source: "MEMBERSHIP" | "DELEGATION";
  authorityId: number;
  unitId: number;
  actorUserId: number;
  roles: readonly InstitutionalRole[];
  validFrom: Date;
  validUntil: Date | null;
  sourceAuthoritySnapshot?: unknown;
};

export function authoritySnapshot(input: AuthoritySnapshotInput) {
  return {
    schemaVersion: 1,
    source: input.source,
    authorityId: input.authorityId,
    unitId: input.unitId,
    actorUserId: input.actorUserId,
    roles: [...input.roles],
    validFrom: input.validFrom.toISOString(),
    validUntil: input.validUntil?.toISOString() ?? null,
    sourceAuthoritySnapshot: input.sourceAuthoritySnapshot ?? null,
    capturedAt: new Date().toISOString(),
  };
}

function scopeAllows(scope: unknown, opts?: { licitacionId?: number; actionCode?: string }) {
  if (!scope || typeof scope !== "object") return true;
  const s = scope as { procedureIds?: unknown; actions?: unknown };
  if (opts?.licitacionId != null && Array.isArray(s.procedureIds) && !s.procedureIds.map(Number).includes(opts.licitacionId)) return false;
  if (opts?.actionCode && Array.isArray(s.actions) && !s.actions.map(String).includes(opts.actionCode)) return false;
  return true;
}

export async function assertDirectUnitMembership(
  user: { id: number; tenantId: number },
  unitId: number,
  role: InstitutionalRole,
) {
  const now = new Date();
  const rows = await getDb().query.organizationalUnitMemberships.findMany({
    where: and(
      eq(organizationalUnitMemberships.tenantId, user.tenantId),
      eq(organizationalUnitMemberships.unitId, unitId),
      eq(organizationalUnitMemberships.userId, user.id),
      eq(organizationalUnitMemberships.role, role),
      eq(organizationalUnitMemberships.active, true),
    ),
  });
  const row = rows.find((m) => m.validFrom <= now && (m.validUntil == null || m.validUntil >= now));
  if (!row) throw new TRPCError({ code: "FORBIDDEN", message: `No tiene membresía directa vigente ${role} en la unidad ${unitId}.` });
  return authoritySnapshot({
    source: "MEMBERSHIP", authorityId: row.id, unitId, actorUserId: user.id,
    roles: [role], validFrom: row.validFrom, validUntil: row.validUntil,
  });
}

export async function assertUnitAuthority(
  user: { id: number; tenantId: number },
  unitId: number,
  requiredRoles: readonly InstitutionalRole[],
  opts?: { licitacionId?: number; actionCode?: string },
) {
  if (!requiredRoles.length) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se definió autoridad institucional requerida." });
  const db = getDb();
  const now = new Date();
  const [memberships, delegationRows] = await Promise.all([
    db.query.organizationalUnitMemberships.findMany({
      where: and(
        eq(organizationalUnitMemberships.tenantId, user.tenantId),
        eq(organizationalUnitMemberships.unitId, unitId),
        eq(organizationalUnitMemberships.userId, user.id),
        eq(organizationalUnitMemberships.active, true),
      ),
    }),
    db.query.authorityDelegations.findMany({
      where: and(
        eq(authorityDelegations.tenantId, user.tenantId),
        eq(authorityDelegations.unitId, unitId),
        eq(authorityDelegations.delegateeUserId, user.id),
        eq(authorityDelegations.active, true),
      ),
    }),
  ]);

  const delegations = delegationRows.filter((d) => scopeAllows(d.scope, opts));
  const evaluated = evaluateInstitutionalAuthority({
    actorUserId: user.id,
    unitId,
    requiredRoles,
    now,
    memberships: memberships.map((m) => ({
      id: m.id, userId: m.userId, unitId: m.unitId, role: m.role, active: m.active,
      validFrom: m.validFrom, validUntil: m.validUntil,
    })),
    delegations: delegations.map((d) => ({
      id: d.id, delegateeUserId: d.delegateeUserId, unitId: d.unitId, role: d.role,
      active: d.active, validFrom: d.validFrom, validUntil: d.validUntil, revokedAt: d.revokedAt,
    })),
  });
  if (!evaluated.ok || evaluated.authorityId == null || !evaluated.source) {
    throw new TRPCError({ code: "FORBIDDEN", message: evaluated.reason ?? "Autoridad institucional insuficiente." });
  }
  if (evaluated.source === "MEMBERSHIP") {
    const m = memberships.find((x) => x.id === evaluated.authorityId)!;
    return authoritySnapshot({
      source: "MEMBERSHIP", authorityId: m.id, unitId, actorUserId: user.id,
      roles: [m.role as InstitutionalRole], validFrom: m.validFrom, validUntil: m.validUntil,
    });
  }
  const d = delegations.find((x) => x.id === evaluated.authorityId)!;
  return authoritySnapshot({
    source: "DELEGATION", authorityId: d.id, unitId, actorUserId: user.id,
    roles: [d.role as InstitutionalRole], validFrom: d.validFrom, validUntil: d.validUntil,
    sourceAuthoritySnapshot: d.sourceAuthoritySnapshot,
  });
}

export async function assertInstitutionalProcedureAuthority(
  user: { id: number; tenantId: number },
  licitacionId: number,
  procedureRoles: readonly string[],
) {
  const lic = await getDb().query.licitaciones.findFirst({
    where: and(eq(licitaciones.tenantId, user.tenantId), eq(licitaciones.id, licitacionId)),
    columns: { id: true, contractingUnitId: true },
  });
  if (!lic) throw new TRPCError({ code: "NOT_FOUND", message: "Procedimiento no encontrado." });
  if (lic.contractingUnitId == null) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El procedimiento no tiene unidad compradora institucional; ejecute la migración/corrección de autoridad." });
  }
  const roles = institutionalRolesForProcedureRoles(procedureRoles);
  if (!roles.length) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "El rol de procedimiento no tiene mapeo institucional." });
  return assertUnitAuthority(user, lic.contractingUnitId, roles, { licitacionId });
}
