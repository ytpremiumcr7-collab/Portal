import { describe, expect, it } from "vitest";
import { isOfferTipo, isPostApertura, OFFER_DOC_TIPOS } from "./document-access";

describe("DocumentAccessPolicy pure helpers", () => {
  it("recognizes offer tipos", () => {
    for (const t of OFFER_DOC_TIPOS) expect(isOfferTipo(t)).toBe(true);
    expect(isOfferTipo("CONVOCATORIA")).toBe(false);
    expect(isOfferTipo("DICTAMEN")).toBe(false);
  });

  it("post-apertura only after ABIERTA/PUBLICADA (and revelatory states)", () => {
    expect(isPostApertura("RECEPCION_ABIERTA")).toBe(false);
    expect(isPostApertura("RECEPCION_CERRADA")).toBe(false);
    expect(isPostApertura("SELLADA")).toBe(false);
    expect(isPostApertura("ABIERTA")).toBe(true);
    expect(isPostApertura("PUBLICADA")).toBe(true);
    expect(isPostApertura("REGISTRADA")).toBe(true);
    expect(isPostApertura("ACTA_EMITIDA")).toBe(true);
    expect(isPostApertura(null)).toBe(false);
  });
});
