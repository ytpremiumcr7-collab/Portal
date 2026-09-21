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
  it("SESSION is labelled as session confirmation, not as FIEL", () => {
    const label = labelForSignatureKind("SESSION_CONFIRMATION").toLowerCase();
    expect(label).toMatch(/no es e\.firma ni fiel/);
    expect(label).toMatch(/sesión|session/);
    expect(label.startsWith("confirmación de sesión")).toBe(true);
  });
  it("crypto gate defaults off", () => {
    expect(cryptoRequiredForAct()).toBe(false);
  });
});

describe("Honest object store / TSA", () => {
  it("live store is filesystem and anchors stay PENDING_EXTERNAL", async () => {
    const { describeObjectStore } = await import("./document-store");
    const snap = describeObjectStore();
    expect(snap.backend).toBe("filesystem");
    expect(snap.anchorsDefault).toBe("PENDING_EXTERNAL");
    expect(snap.note.toLowerCase()).toMatch(/filesystem/);
  });
});

describe("IM document support gate", () => {
  it("rejects missing, obsolete, rejected or foreign documents", async () => {
    const { evaluateFuenteDocumento } = await import("./investigacion-mercado");
    expect(evaluateFuenteDocumento(null)).toMatch(/no existe/);
    expect(evaluateFuenteDocumento({ esVersionVigente: false, estado: "APROBADO", licitacionId: 1 })).toMatch(/vigente/);
    expect(evaluateFuenteDocumento({ esVersionVigente: true, estado: "RECHAZADO", licitacionId: 1 })).toMatch(/RECHAZADO/);
    expect(evaluateFuenteDocumento({ esVersionVigente: true, estado: "OBSOLETO", licitacionId: 1 })).toMatch(/OBSOLETO/);
    expect(evaluateFuenteDocumento({ esVersionVigente: true, estado: "APROBADO", licitacionId: 9 }, 3)).toMatch(/otra licitación/);
    expect(evaluateFuenteDocumento({ esVersionVigente: true, estado: "PENDIENTE", licitacionId: null }, 3)).toMatch(/vinculado a la licitación/);
    expect(evaluateFuenteDocumento({ esVersionVigente: true, estado: "PENDIENTE", licitacionId: 3, tipo: "OFERTA_ECONOMICA" }, 3)).toMatch(/no acredita/);
    expect(evaluateFuenteDocumento({ esVersionVigente: true, estado: "PENDIENTE", licitacionId: 3, tipo: "CONVOCATORIA" }, 3)).toMatch(/no acredita/);
    expect(evaluateFuenteDocumento({ esVersionVigente: true, estado: "PENDIENTE", licitacionId: 3, tipo: "OTRO" }, 3)).toBeNull();
    expect(evaluateFuenteDocumento({ esVersionVigente: true, estado: "PENDIENTE", licitacionId: 3 }, 3)).toBeNull();
  });
});

describe("IM close gate", () => {
  it("rejects undocumented or single-type sources", async () => {
    const { assertEstudioPuedeCerrarse, assertEstudioListoParaCerrar } = await import("./investigacion-mercado");
    expect(() => assertEstudioPuedeCerrarse([{ tipo: "OFICIO", documentoId: 1 }])).toThrow();
    expect(() => assertEstudioPuedeCerrarse([
      { tipo: "OFICIO", documentoId: 1 },
      { tipo: "OFICIO", documentoId: 2 },
    ])).toThrow();
    expect(() => assertEstudioPuedeCerrarse([
      { tipo: "OFICIO", documentoId: null },
      { tipo: "CONSULTA_WEB", documentoId: 2 },
    ])).toThrow();
    expect(() => assertEstudioPuedeCerrarse([
      { tipo: "OFICIO", documentoId: 1 },
      { tipo: "CONSULTA_WEB", documentoId: 2 },
    ])).not.toThrow();
    expect(() => assertEstudioListoParaCerrar({
      licitacionId: null,
      fuentes: [{ tipo: "OFICIO", documentoId: 1 }, { tipo: "CONSULTA_WEB", documentoId: 2 }],
    })).toThrow(/huérfano/);
    expect(() => assertEstudioListoParaCerrar({
      licitacionId: 9,
      fuentes: [{ tipo: "OFICIO", documentoId: 1 }, { tipo: "CONSULTA_WEB", documentoId: 2 }],
    })).not.toThrow();
  });
});
