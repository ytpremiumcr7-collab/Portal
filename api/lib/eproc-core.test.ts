import { describe, expect, it } from "vitest";
import {
  evaluateInstitutionalAuthority,
  assertWorkTaskTransition,
  hashSubmissionReceipt,
  validateAwardAllocation,
  resolveFalloLotDecisions,
} from "./eproc-core";

describe("institutional authority", () => {
  const now = new Date("2026-09-24T18:00:00.000Z");

  it("allows an active unit membership with the required institutional role", () => {
    const result = evaluateInstitutionalAuthority({
      actorUserId: 10,
      unitId: 7,
      requiredRoles: ["OPERADOR"],
      now,
      memberships: [{
        id: 91,
        userId: 10,
        unitId: 7,
        role: "OPERADOR",
        active: true,
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
        validUntil: null,
      }],
      delegations: [],
    });

    expect(result).toEqual({ ok: true, source: "MEMBERSHIP", authorityId: 91 });
  });

  it("rejects expired membership and accepts a valid scoped delegation", () => {
    const expired = evaluateInstitutionalAuthority({
      actorUserId: 10,
      unitId: 7,
      requiredRoles: ["APROBADOR"],
      now,
      memberships: [{
        id: 92,
        userId: 10,
        unitId: 7,
        role: "APROBADOR",
        active: true,
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
        validUntil: new Date("2026-09-23T23:59:59.000Z"),
      }],
      delegations: [],
    });
    expect(expired.ok).toBe(false);

    const delegated = evaluateInstitutionalAuthority({
      actorUserId: 10,
      unitId: 7,
      requiredRoles: ["APROBADOR"],
      now,
      memberships: [],
      delegations: [{
        id: 44,
        delegateeUserId: 10,
        unitId: 7,
        role: "APROBADOR",
        active: true,
        validFrom: new Date("2026-09-20T00:00:00.000Z"),
        validUntil: new Date("2026-09-30T00:00:00.000Z"),
        revokedAt: null,
      }],
    });
    expect(delegated).toEqual({ ok: true, source: "DELEGATION", authorityId: 44 });
  });

  it("never lets authority leak across contracting units", () => {
    const result = evaluateInstitutionalAuthority({
      actorUserId: 10,
      unitId: 8,
      requiredRoles: ["OPERADOR"],
      now,
      memberships: [{
        id: 93,
        userId: 10,
        unitId: 7,
        role: "OPERADOR",
        active: true,
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
        validUntil: null,
      }],
      delegations: [],
    });
    expect(result.ok).toBe(false);
  });
});

describe("work task lifecycle", () => {
  it("enforces explicit review/approval states", () => {
    expect(() => assertWorkTaskTransition("PENDIENTE", "EN_PROGRESO")).not.toThrow();
    expect(() => assertWorkTaskTransition("EN_PROGRESO", "EN_REVISION")).not.toThrow();
    expect(() => assertWorkTaskTransition("EN_REVISION", "APROBADA")).not.toThrow();
    expect(() => assertWorkTaskTransition("APROBADA", "EN_PROGRESO")).toThrow();
    expect(() => assertWorkTaskTransition("CANCELADA", "APROBADA")).toThrow();
  });
});

describe("submission receipts", () => {
  it("hashes the immutable receipt envelope including version and supersession", () => {
    const base = {
      schemaVersion: 1,
      algorithm: "SHA256" as const,
      receiptCode: "RCP-test",
      tenantId: 1,
      procedureId: 20,
      lotId: 2,
      submissionId: 30,
      representedProviderId: 35,
      supplierOrganizationId: 40,
      submittedByUserId: 50,
      supplierMembershipId: 55,
      actingAuthorityId: 60,
      authoritySnapshot: { authorityId: 60, membershipId: 55, lotId: 2 },
      manifestHash: "a".repeat(64),
      sealHash: "b".repeat(64),
      ciphertextHash: "c".repeat(64),
      serverReceivedAt: "2026-09-24T18:00:00.000Z",
      submissionVersion: 1,
      supersedesSubmissionId: null as number | null,
      receiptType: "SUBMISSION" as const,
    };
    const hash1 = hashSubmissionReceipt(base);
    const hash2 = hashSubmissionReceipt({ ...base });
    const replaced = hashSubmissionReceipt({ ...base, submissionVersion: 2, supersedesSubmissionId: 30 });
    const otherLot = hashSubmissionReceipt({ ...base, lotId: 3 });
    const otherAuthority = hashSubmissionReceipt({ ...base, actingAuthorityId: 61 });

    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    expect(hash1).toBe(hash2);
    expect(replaced).not.toBe(hash1);
    expect(otherLot).not.toBe(hash1);
    expect(otherAuthority).not.toBe(hash1);
  });
});

describe("lot and award allocation", () => {
  it("supports multiple awards in one procedure but refuses cross-lot/cross-procedure allocation", () => {
    expect(() => validateAwardAllocation({
      procedureId: 100,
      lotId: 2,
      supplierId: 9,
      amount: "125000.00",
      lot: { id: 2, procedureId: 100, status: "ACTIVE" },
    })).not.toThrow();

    expect(() => validateAwardAllocation({
      procedureId: 100,
      lotId: 2,
      supplierId: 9,
      amount: "125000.00",
      lot: { id: 2, procedureId: 101, status: "ACTIVE" },
    })).toThrow(/procedimiento/);

    expect(() => validateAwardAllocation({
      procedureId: 100,
      lotId: 2,
      supplierId: 9,
      amount: "-1.00",
      lot: { id: 2, procedureId: 100, status: "ACTIVE" },
    })).toThrow(/monto/i);
  });

  it("resolves every active lot exactly once and derives award data from the admissible offer", () => {
    const resolved = resolveFalloLotDecisions({
      procedureId: 100,
      lots: [
        { id: 2, procedureId: 100, status: "ACTIVE" },
        { id: 3, procedureId: 100, status: "ACTIVE" },
      ],
      offers: [{
        id: 20,
        procedureId: 100,
        lotId: 2,
        supplierId: 9,
        status: "ADMISIBLE",
        amount: "125000.00",
      }],
      decisions: [
        { lotId: 2, outcome: "ADJUDICAR", participationId: 20, reason: "Oferta solvente con mejor resultado por lote." },
        { lotId: 3, outcome: "DESIERTO", reason: "No se recibieron ofertas solventes para este lote." },
      ],
    });

    expect(resolved).toEqual([
      expect.objectContaining({ lotId: 2, supplierId: 9, participationId: 20, amount: "125000.00" }),
      expect.objectContaining({ lotId: 3, supplierId: null, participationId: null, amount: null }),
    ]);
  });

  it("rejects missing/duplicate lot decisions and cross-lot offers", () => {
    const base = {
      procedureId: 100,
      lots: [
        { id: 2, procedureId: 100, status: "ACTIVE" },
        { id: 3, procedureId: 100, status: "ACTIVE" },
      ],
      offers: [{
        id: 20,
        procedureId: 100,
        lotId: 2,
        supplierId: 9,
        status: "ADMISIBLE",
        amount: "125000.00",
      }],
    };

    expect(() => resolveFalloLotDecisions({
      ...base,
      decisions: [{ lotId: 2, outcome: "DESIERTO" as const, reason: "Sin oferta solvente para el lote." }],
    })).toThrow(/todos los lotes activos/i);

    expect(() => resolveFalloLotDecisions({
      ...base,
      decisions: [
        { lotId: 2, outcome: "DESIERTO" as const, reason: "Sin oferta solvente para el lote." },
        { lotId: 2, outcome: "CANCELAR" as const, reason: "Cancelación debidamente fundada del lote." },
      ],
    })).toThrow(/duplicada/i);

    expect(() => resolveFalloLotDecisions({
      ...base,
      decisions: [
        { lotId: 3, outcome: "ADJUDICAR" as const, participationId: 20, reason: "Decisión deliberadamente inválida entre lotes." },
        { lotId: 2, outcome: "DESIERTO" as const, reason: "Sin oferta solvente para el lote." },
      ],
    })).toThrow(/lote/i);
  });
});
