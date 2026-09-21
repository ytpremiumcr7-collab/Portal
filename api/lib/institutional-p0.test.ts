import { describe, expect, it } from "vitest";
import { canonicalEventV1, canonicalEventV2, hashCanonical, EVIDENCE_SCHEMA_V2 } from "./evidence-canonical";
import { canExpireRetention } from "./legal-hold";
import { evaluateProcedimientoAsignacion } from "./sod";
import { labelForSignatureKind } from "./firma";
import { cryptoRequiredForAct } from "./institutional-env";

describe("Evidence envelope v2", () => {
  const base = {
    expedienteId: 7, secuencia: 3, tipo: "APERTURA_SELLADA",
    estadoAnterior: "RECEPCION_CERRADA", estadoNuevo: "SELLADA",
    actorUserId: 11, motivo: "cierre", payload: { aperturaId: 2 },
    timestamp: "2026-09-20T18:00:00.000Z", previousHash: "abc",
  };
  it("v2 covers IP; v1 does not", () => {
    const v1 = hashCanonical(canonicalEventV1(base));
    const a = hashCanonical(canonicalEventV2({ ...base, schemaVersion: EVIDENCE_SCHEMA_V2, tenantId: 1, actorCapability: "sellar_propuestas", requestId: "req-a", sourceIp: "1.1.1.1", verifiedClientIp: "1.1.1.1" }));
    const b = hashCanonical(canonicalEventV2({ ...base, schemaVersion: EVIDENCE_SCHEMA_V2, tenantId: 1, actorCapability: "sellar_propuestas", requestId: "req-a", sourceIp: "9.9.9.9", verifiedClientIp: "9.9.9.9" }));
    expect(v1).toHaveLength(64);
    expect(a).not.toBe(v1);
    expect(a).not.toBe(b);
  });
});

describe("Legal hold retention", () => {
  it("hold blocks expiry", () => {
    expect(canExpireRetention({ retentionUntil: new Date("2020-01-01"), legalHoldActive: true })).toBe(false);
    expect(canExpireRetention({ retentionUntil: new Date("2020-01-01"), legalHoldActive: false, now: new Date("2026-01-01") })).toBe(true);
  });
});

describe("Apertura SoD", () => {
  it("creador is not sellar_propuestas", () => {
    expect(evaluateProcedimientoAsignacion({ userRole: "licitante", heldRoles: ["creador"], required: ["sellar_propuestas"] }).ok).toBe(false);
  });
});

describe("Honest FIEL labels", () => {
  it("SESSION never says FIEL", () => {
    expect(labelForSignatureKind("SESSION_CONFIRMATION").toLowerCase()).not.toMatch(/fiel/);
  });
  it("crypto gate defaults off", () => {
    expect(cryptoRequiredForAct()).toBe(false);
  });
});
