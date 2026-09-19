import { describe, expect, it, beforeAll } from "vitest";
import {
  sealMontoOferta,
  openMontoOferta,
  ciphertextDiffersFromPlaintext,
  ENVELOPE_PLACEHOLDER_MONTO,
  currentEnvelopeKeyVersion,
} from "./envelope-crypto";
import { canViewMontoOferta, isSobreEconomicoRevelado } from "./sobre-economico";

describe("economic envelope AES-256-GCM", () => {
  beforeAll(() => {
    if (!process.env.ARES_ENVELOPE_KEY) {
      process.env.ARES_ENVELOPE_KEY = Buffer.from("piedra-angular-dev-envelope-key!!").toString("base64");
      process.env.ARES_ENVELOPE_KEY_VERSION = "1";
    }
  });

  it("seals and opens monto round-trip", () => {
    const seal = sealMontoOferta("12345.67");
    expect(seal.algorithm).toBe("AES-256-GCM");
    expect(seal.keyVersion).toBe(currentEnvelopeKeyVersion());
    expect(ciphertextDiffersFromPlaintext(seal.ciphertext, "12345.67")).toBe(true);
    expect(openMontoOferta(seal)).toBe("12345.67");
  });

  it("ciphertext is not plaintext or trivial base64 of plaintext", () => {
    const seal = sealMontoOferta("999.50");
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
