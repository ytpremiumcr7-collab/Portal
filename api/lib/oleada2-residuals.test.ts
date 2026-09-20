import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  SessionConfirmationProvider,
  SatEFirmaProvider,
  getSignatureProvider,
  assertCryptoKindWhenRequired,
  loadSatCasBundle,
  labelForSignatureKind,
} from "./firma";
import {
  assertModalidadPublishable,
  assertModalidadWorkflowSupported,
  assertTransitionAllowed,
  mergeModalidadRequisitos,
  LAASSP_MODALIDADES,
} from "./procedure-policy";
import { normalizeRfc, assertRfcShape } from "./supplier-legal-entity";
import { policyRequiresCryptoFirma } from "./firmas-electronicas";

describe("Oleada 2 — SatEFirma CRYPTO path honesty", () => {
  const prevOcsp = process.env.PA_EFIRMA_OCSP;
  afterEach(() => {
    if (prevOcsp === undefined) delete process.env.PA_EFIRMA_OCSP;
    else process.env.PA_EFIRMA_OCSP = prevOcsp;
  });

  it("SatEFirmaProvider reports NOT_CONFIGURED when CAs missing", async () => {
    process.env.PA_EFIRMA_OCSP = "0";
    const empty = loadSatCasBundle("/tmp/pa-sat-cas-empty-definitely-missing");
    expect(empty.configured).toBe(false);
    const sat = new SatEFirmaProvider(empty);
    expect(sat.isConfigured()).toBe(false);
    await expect(
      sat.sign({
        tenantId: 1,
        signerUserId: 1,
        payload: { x: 1 },
        crypto: { cer: "AAAA", key: "BBBB", password: "x" },
      }),
    ).rejects.toThrow(/NOT_CONFIGURED/);
    const v = await sat.verify({
      kind: "CRYPTO_SIGNATURE",
      documentDigest: "a".repeat(64),
      signatureValue: null,
      certificatePem: null,
    });
    expect(v.status).toBe("NOT_CONFIGURED");
  });

  it("rejects SESSION when CRYPTO required", () => {
    expect(() => assertCryptoKindWhenRequired(true, "SESSION_CONFIRMATION")).toThrow(/CRYPTO_SIGNATURE/);
    expect(() => assertCryptoKindWhenRequired(true, "CRYPTO_SIGNATURE")).not.toThrow();
    expect(() => assertCryptoKindWhenRequired(false, "SESSION_CONFIRMATION")).not.toThrow();
  });

  it("SESSION provider still works; label honest", async () => {
    const p = new SessionConfirmationProvider();
    const signed = await p.sign({ tenantId: 1, signerUserId: 1, payload: { a: 1 } });
    expect(signed.kind).toBe("SESSION_CONFIRMATION");
    expect(signed.certSerial).toBeNull();
    expect(labelForSignatureKind("SESSION_CONFIRMATION").toLowerCase()).toMatch(/no es e\.firma ni fiel/);
    expect(getSignatureProvider("CRYPTO_SIGNATURE").name).toBe("SatEFirmaProvider");
  });

  it("policyRequiresCryptoFirma reads flag", () => {
    expect(policyRequiresCryptoFirma({ requiereFirmaElectronicaAvanzada: true })).toBe(true);
    expect(policyRequiresCryptoFirma({})).toBe(false);
  });
});

describe("Oleada 2 — modalities 4–7 publish/transition gates", () => {
  it("catalog has 7 LAASSP types", () => {
    expect(LAASSP_MODALIDADES).toHaveLength(7);
  });

  it("DIALOGO / ADN refuse publish without Comité/Hacienda meta", () => {
    expect(() => assertModalidadPublishable("DIALOGO_COMPETITIVO", {})).toThrow(/autorizacionComiteRef/);
    expect(() =>
      assertModalidadPublishable("DIALOGO_COMPETITIVO", {
        autorizacionComiteRef: "COMITE-1",
        autorizadoPorHacienda: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertModalidadPublishable("ADJUDICACION_DIRECTA_NEGOCIACION", {
        autorizacionComiteRef: "C-2",
      }),
    ).toThrow(/autorizadoPorHacienda/);
  });

  it("ACUERDO_MARCO and TIENDA require references", () => {
    expect(() => assertModalidadPublishable("ACUERDO_MARCO_ASIGNACION", {})).toThrow(/acuerdoMarco/);
    expect(() =>
      assertModalidadPublishable("ACUERDO_MARCO_ASIGNACION", { acuerdoMarcoRef: "AM-9" }),
    ).not.toThrow();
    expect(() => assertModalidadPublishable("TIENDA_DIGITAL_ORDEN", {})).toThrow(/tiendaCatalogoRef|ordenCompraRef/);
    expect(() =>
      assertModalidadPublishable("TIENDA_DIGITAL_ORDEN", { ordenCompraRef: "OC-1" }),
    ).not.toThrow();
  });

  it("LP still publishes without special meta", () => {
    expect(() => assertModalidadPublishable("LICITACION_PUBLICA", {})).not.toThrow();
    expect(() => assertModalidadWorkflowSupported("LICITACION_PUBLICA")).not.toThrow();
  });

  it("TIENDA refuses LP presentación; ADN requires negotiation notes before fallo", () => {
    expect(() =>
      assertTransitionAllowed("TIENDA_DIGITAL_ORDEN", "PRESENTACION_LP", { ordenCompraRef: "OC-1" }),
    ).toThrow(/no aplica/);
    expect(() => assertTransitionAllowed("ADJUDICACION_DIRECTA_NEGOCIACION", "FALLO", {})).toThrow(
      /notasNegociacion/,
    );
    expect(() =>
      assertTransitionAllowed("ADJUDICACION_DIRECTA_NEGOCIACION", "FALLO", {
        notasNegociacion: "Negociación documentada 2026-01-01",
      }),
    ).not.toThrow();
  });

  it("mergeModalidadRequisitos overlays procedure meta on policy", () => {
    const m = mergeModalidadRequisitos(
      { constrainedBy: "HACIENDA_COMITE" },
      { autorizacionComiteRef: "X", autorizadoPorHacienda: true },
    );
    expect(m.autorizacionComiteRef).toBe("X");
    expect(m.constrainedBy).toBe("HACIENDA_COMITE");
  });
});

describe("Oleada 2 — RFC legal entity helpers", () => {
  it("normalizes and validates RFC", () => {
    expect(normalizeRfc(" xaXx010101000 ")).toBe("XAXX010101000");
    expect(assertRfcShape("ABC010101ABC")).toMatch(/^ABC/);
    expect(() => assertRfcShape("BAD")).toThrow(TRPCError);
  });
});
