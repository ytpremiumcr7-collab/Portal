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

export type FalloLotOutcome = "ADJUDICAR" | "DESIERTO" | "CANCELAR";

type FalloLot = {
  id: number;
  procedureId: number;
  status: string;
};

type FalloOffer = {
  id: number;
  procedureId: number;
  lotId: number;
  supplierId: number;
  status: string;
  amount: string | number;
};

type FalloLotDecisionInput = {
  lotId: number;
  outcome: FalloLotOutcome;
  participationId?: number | null;
  reason: string;
};

export type ResolvedFalloLotDecision = {
  lotId: number;
  outcome: FalloLotOutcome;
  participationId: number | null;
  supplierId: number | null;
  amount: string | null;
  reason: string;
};

/**
 * Resolves the complete set of lot decisions without trusting supplier or amount
 * supplied by the caller. Award facts always come from the evaluated offer.
 */
export function resolveFalloLotDecisions(input: {
  procedureId: number;
  lots: FalloLot[];
  offers: FalloOffer[];
  decisions: FalloLotDecisionInput[];
}): ResolvedFalloLotDecision[] {
  const activeLots = input.lots.filter((lot) => lot.status === "ACTIVE");
  if (!activeLots.length) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El procedimiento no tiene lotes activos por resolver." });
  }
  if (activeLots.some((lot) => lot.procedureId !== input.procedureId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Un lote pertenece a otro procedimiento." });
  }

  const decisionLotIds = input.decisions.map((decision) => decision.lotId);
  if (new Set(decisionLotIds).size !== decisionLotIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Existe una decisión duplicada para el mismo lote." });
  }
  const activeLotIds = new Set(activeLots.map((lot) => lot.id));
  if (
    input.decisions.length !== activeLots.length ||
    decisionLotIds.some((lotId) => !activeLotIds.has(lotId)) ||
    activeLots.some((lot) => !decisionLotIds.includes(lot.id))
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "El fallo debe resolver todos los lotes activos exactamente una vez." });
  }

  return input.decisions.map((decision) => {
    const reason = decision.reason.trim();
    if (reason.length < 20) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `El fundamento del lote ${decision.lotId} es insuficiente.` });
    }
    if (decision.outcome !== "ADJUDICAR") {
      if (decision.participationId != null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `El lote ${decision.lotId} no adjudicado no puede señalar una oferta ganadora.` });
      }
      return {
        lotId: decision.lotId,
        outcome: decision.outcome,
        participationId: null,
        supplierId: null,
        amount: null,
        reason,
      };
    }

    if (decision.participationId == null) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `La adjudicación del lote ${decision.lotId} requiere una oferta.` });
    }
    const offer = input.offers.find((candidate) => candidate.id === decision.participationId);
    if (!offer) {
      throw new TRPCError({ code: "NOT_FOUND", message: `La oferta ${decision.participationId} no existe.` });
    }
    if (offer.procedureId !== input.procedureId || offer.lotId !== decision.lotId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `La oferta ${offer.id} no pertenece al procedimiento y lote decididos.` });
    }
    if (offer.status !== "ADMISIBLE") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `La oferta ${offer.id} no es admisible.` });
    }
    validateAwardAllocation({
      procedureId: input.procedureId,
      lotId: decision.lotId,
      supplierId: offer.supplierId,
      amount: offer.amount,
      lot: activeLots.find((lot) => lot.id === decision.lotId),
    });
    return {
      lotId: decision.lotId,
      outcome: decision.outcome,
      participationId: offer.id,
      supplierId: offer.supplierId,
      amount: String(offer.amount),
      reason,
    };
  });
}
