import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";

export type InstitutionalRole =
  | "OPERADOR" | "TECNICO" | "JURIDICO" | "PRESUPUESTO"
  | "APROBADOR" | "ADMIN_CONTRATO" | "AUDITOR";

type MembershipSnapshot = {
  id: number;
  userId: number;
  unitId: number;
  role: string;
  active: boolean;
  validFrom: Date;
  validUntil: Date | null;
};

type DelegationSnapshot = {
  id: number;
  delegateeUserId: number;
  unitId: number;
  role: string;
  active: boolean;
  validFrom: Date;
  validUntil: Date;
  revokedAt: Date | null;
};

function activeAt(validFrom: Date, validUntil: Date | null, now: Date) {
  return validFrom.getTime() <= now.getTime() &&
    (validUntil == null || validUntil.getTime() >= now.getTime());
}

export function evaluateInstitutionalAuthority(input: {
  actorUserId: number;
  unitId: number;
  requiredRoles: readonly string[];
  now?: Date;
  memberships: MembershipSnapshot[];
  delegations: DelegationSnapshot[];
}): { ok: boolean; source?: "MEMBERSHIP" | "DELEGATION"; authorityId?: number | null; reason?: string } {
  const now = input.now ?? new Date();
  const membership = input.memberships.find((m) =>
    m.userId === input.actorUserId &&
    m.unitId === input.unitId &&
    m.active &&
    input.requiredRoles.includes(m.role) &&
    activeAt(m.validFrom, m.validUntil, now),
  );
  if (membership) return { ok: true, source: "MEMBERSHIP", authorityId: membership.id };

  const delegation = input.delegations.find((d) =>
    d.delegateeUserId === input.actorUserId &&
    d.unitId === input.unitId &&
    d.active &&
    d.revokedAt == null &&
    input.requiredRoles.includes(d.role) &&
    activeAt(d.validFrom, d.validUntil, now),
  );
  if (delegation) return { ok: true, source: "DELEGATION", authorityId: delegation.id };

  return {
    ok: false,
    reason: `No existe autoridad institucional vigente en la unidad ${input.unitId} para: ${input.requiredRoles.join(" | ")}.`,
  };
}

export type WorkTaskState =
  | "PENDIENTE" | "EN_PROGRESO" | "EN_REVISION"
  | "APROBADA" | "RECHAZADA" | "DEVUELTA" | "CANCELADA" | "VENCIDA";

const WORK_TASK_TRANSITIONS: Record<WorkTaskState, readonly WorkTaskState[]> = {
  PENDIENTE: ["EN_PROGRESO", "CANCELADA", "VENCIDA"],
  EN_PROGRESO: ["EN_REVISION", "APROBADA", "CANCELADA", "VENCIDA"],
  EN_REVISION: ["APROBADA", "RECHAZADA", "DEVUELTA"],
  APROBADA: [],
  RECHAZADA: [],
  DEVUELTA: ["EN_PROGRESO", "CANCELADA", "VENCIDA"],
  CANCELADA: [],
  VENCIDA: [],
};

export function assertWorkTaskTransition(from: WorkTaskState, to: WorkTaskState) {
  if (!WORK_TASK_TRANSITIONS[from]?.includes(to)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Transición de tarea inválida: ${from} → ${to}.`,
    });
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export type SubmissionReceiptEnvelope = {
  schemaVersion: number;
  algorithm: "SHA256";
  receiptCode: string;
  tenantId: number;
  procedureId: number;
  lotId: number;
  submissionId: number;
  representedProviderId: number;
  supplierOrganizationId: number;
  submittedByUserId: number;
  supplierMembershipId: number;
  actingAuthorityId: number;
  authoritySnapshot: unknown;
  manifestHash: string;
  sealHash: string;
  ciphertextHash: string;
  serverReceivedAt: string;
  submissionVersion: number;
  supersedesSubmissionId: number | null;
  receiptType: "SUBMISSION" | "WITHDRAWAL" | "REPLACEMENT";
};

export function hashSubmissionReceipt(input: SubmissionReceiptEnvelope): string {
  return createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex");
}

export function validateAwardAllocation(input: {
  procedureId: number;
  lotId: number;
  supplierId: number;
  amount: string | number;
  lot: { id: number; procedureId: number; status: string } | null | undefined;
}) {
  if (!input.lot || input.lot.id !== input.lotId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Lote no encontrado." });
  }
  if (input.lot.procedureId !== input.procedureId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "El lote pertenece a otro procedimiento." });
  }
  if (!["ACTIVE", "AWARDED"].includes(input.lot.status)) {
    throw new TRPCError({ code: "CONFLICT", message: "El lote no admite adjudicación." });
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "El monto de adjudicación no puede ser negativo." });
  }
  if (!Number.isInteger(input.supplierId) || input.supplierId <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Proveedor inválido." });
  }
}
