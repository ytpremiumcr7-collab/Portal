import { describe, expect, it, beforeAll } from "vitest";
import {
  sealMontoOferta,
  openMontoOferta,
  ciphertextDiffersFromPlaintext,
  ENVELOPE_PLACEHOLDER_MONTO,
  currentEnvelopeKeyVersion,
  buildEnvelopeAad,
} from "./envelope-crypto";
import { canViewMontoOferta, isSobreEconomicoRevelado } from "./sobre-economico";

const aad = {
  tenantId: 1,
  licitacionId: 1,
  participacionId: 1,
  proposicionId: 1,
  keyVersion: 1,
};

describe("economic envelope AES-256-GCM", () => {
  beforeAll(() => {
    if (!process.env.ARES_ENVELOPE_KEY) {
      process.env.ARES_ENVELOPE_KEY = Buffer.from("piedra-angular-dev-envelope-key!!").toString("base64");
      process.env.ARES_ENVELOPE_KEY_VERSION = "1";
    }
    aad.keyVersion = currentEnvelopeKeyVersion();
  });

  it("seals and opens monto round-trip with AAD", () => {
    const seal = sealMontoOferta("12345.67", aad);
    expect(seal.algorithm).toBe("AES-256-GCM");
    expect(seal.keyVersion).toBe(currentEnvelopeKeyVersion());
    expect(ciphertextDiffersFromPlaintext(seal.ciphertext, "12345.67")).toBe(true);
    expect(openMontoOferta(seal, aad)).toBe("12345.67");
    expect(seal.aad).toBe(buildEnvelopeAad(aad));
  });

  it("ciphertext is not plaintext or trivial base64 of plaintext", () => {
    const seal = sealMontoOferta("999.50", aad);
    expect(seal.ciphertext).not.toBe("999.50");
    expect(seal.ciphertext).not.toBe(Buffer.from("999.50", "utf8").toString("base64"));
    expect(seal.nonceIv.length).toBeGreaterThan(8);
    expect(seal.authTag.length).toBeGreaterThan(8);
  });

  it("placeholder is used pre-reveal in DB column", () => {
    expect(ENVELOPE_PLACEHOLDER_MONTO).toBe("0.00");
  });

  it("API visibility still gated until apertura reveal states", () => {
    expect(canViewMontoOferta({ role: "licitante", isOwner: false, aperturaEstado: "SELLADA" })).toBe(false);
    expect(isSobreEconomicoRevelado("ABIERTA")).toBe(true);
    expect(canViewMontoOferta({ role: "licitante", isOwner: false, aperturaEstado: "ABIERTA" })).toBe(true);
  });
});
