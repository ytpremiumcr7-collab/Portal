import { describe, expect, it } from "vitest";
import { detectMimeFromMagic, assertMimeAllowed } from "./mime-detect";
import { digestPayload } from "./firmas-electronicas";
import { createEnvelopeKeyProviderFromEnv, EnvKeyProvider } from "./envelope-key-provider";
import { assertDocumentoBoundToContext } from "./documento-binding";

describe("0017 P1 close-out gates", () => {
  it("detects PDF magic and rejects unknown", () => {
    const pdf = Buffer.from("%PDF-1.7\n...");
    expect(detectMimeFromMagic(pdf)).toBe("application/pdf");
    assertMimeAllowed("application/pdf");
    expect(() => detectMimeFromMagic(Buffer.from("not-a-file"))).toThrow();
  });

  it("firma digest is stable sha256 hex", () => {
    const d = digestPayload({ a: 1, b: "x" });
    expect(d).toMatch(/^[a-f0-9]{64}$/);
    expect(digestPayload({ a: 1, b: "x" })).toBe(d);
  });

  it("envelope provider defaults to env", () => {
    const p = createEnvelopeKeyProviderFromEnv();
    expect(p.name).toBe("env");
    expect(new EnvKeyProvider().resolveKey(1)).toBeInstanceOf(Buffer);
    expect(new EnvKeyProvider().resolveKey(1).length).toBe(32);
  });

  it("documento binding rejects cross-licitacion evidence", () => {
    expect(() =>
      assertDocumentoBoundToContext(
        { tenantId: 1, tipo: "DICTAMEN", estado: "APROBADO", esVersionVigente: true, licitacionId: 9, expedienteId: 1 },
        { tenantId: 1, expectedTipo: "DICTAMEN", licitacionId: 2, expedienteId: 1 },
      ),
    ).toThrow(/licitación/i);
  });

  it("documento binding requires the exact awarded lot when the context is lot-scoped", () => {
    const contractDocument = {
      tenantId: 1,
      tipo: "CONTRATO",
      estado: "APROBADO",
      esVersionVigente: true,
      licitacionId: 9,
      expedienteId: 1,
      lotId: 20,
    };
    expect(() => assertDocumentoBoundToContext(contractDocument, {
      tenantId: 1,
      expectedTipo: "CONTRATO",
      licitacionId: 9,
      expedienteId: 1,
      lotId: 21,
    })).toThrow(/lote adjudicado/i);
    expect(() => assertDocumentoBoundToContext(contractDocument, {
      tenantId: 1,
      expectedTipo: "CONTRATO",
      licitacionId: 9,
      expedienteId: 1,
      lotId: 20,
    })).not.toThrow();
  });
});
