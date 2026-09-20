import { describe, expect, it } from "vitest";
import {
  money, moneyAdd, moneyFixed2, moneyDiv, moneyCmp, toCentavos, fromCentavos,
} from "./money";
import { scoreEconomico, scoreTotalRelacion } from "./evaluation-engine";
import { assertRecepcionAtInstant, isWithinRecepcionMs } from "./calendario-gates";
import { buildProposicionManifest } from "./proposicion";

describe("money.ts decimal arithmetic", () => {
  it("avoids 0.1+0.2 IEEE trap", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(moneyFixed2(moneyAdd("0.1", "0.2"))).toBe("0.30");
    expect(moneyCmp(moneyAdd("0.1", "0.2"), "0.3")).toBe(0);
  });

  it("centavos round-trip", () => {
    expect(toCentavos("10.01")).toBe(1001n);
    expect(fromCentavos(1001n)).toBe("10.01");
    expect(fromCentavos(toCentavos("0.1") + toCentavos("0.2"))).toBe("0.30");
  });

  it("scoreEconomico uses decimal ratio", () => {
    // min/bid * 100 with awkward decimals
    const s = scoreEconomico("33.33", "10.00");
    expect(s).toBeCloseTo(30.0, 1);
    expect(Number.isFinite(s)).toBe(true);
  });

  it("scoreTotalRelacion stays 2dp", () => {
    const t = scoreTotalRelacion("80", "90", "40", "60");
    expect(moneyFixed2(t)).toBe("86.00");
  });
});

describe("reception same-instant invariant", () => {
  it("deadline+1ms rejects with assertRecepcionAtInstant", () => {
    const fin = new Date("2026-09-19T18:00:00.000Z");
    const row = { ventanaInicio: new Date("2026-09-01T00:00:00.000Z"), ventanaFin: fin };
    expect(() => assertRecepcionAtInstant(row, new Date(fin.getTime() + 1))).toThrow(/cerró/);
    expect(() => assertRecepcionAtInstant(row, fin)).not.toThrow();
    expect(isWithinRecepcionMs(fin.getTime(), fin.getTime())).toBe(true);
    expect(isWithinRecepcionMs(fin.getTime() + 1, fin.getTime())).toBe(false);
  });
});

describe("consorcio in manifest", () => {
  it("changes hash when miembros change", () => {
    const base = {
      proposicionId: 1,
      participacionId: 2,
      proveedorId: 3,
      ciphertextHash: "a".repeat(64),
      recibidoAt: "2026-09-18T12:00:00.000Z",
      documentos: [{ documentoId: 1, rol: "OFERTA_TECNICA" as const, sha256: "b".repeat(64) }, { documentoId: 2, rol: "OFERTA_ECONOMICA" as const, sha256: "c".repeat(64) }],
      consorcioId: 9,
      consorcioMiembros: [
        { proveedorId: 3, rol: "LIDER", porcentajeParticipacion: "60.00" },
        { proveedorId: 4, rol: "MIEMBRO", porcentajeParticipacion: "40.00" },
      ],
    };
    const h1 = buildProposicionManifest(base).manifestHash;
    const h2 = buildProposicionManifest({
      ...base,
      consorcioMiembros: [
        { proveedorId: 3, rol: "LIDER", porcentajeParticipacion: "50.00" },
        { proveedorId: 4, rol: "MIEMBRO", porcentajeParticipacion: "50.00" },
      ],
    }).manifestHash;
    expect(h1).not.toBe(h2);
    const h0 = buildProposicionManifest({ ...base, consorcioId: undefined, consorcioMiembros: undefined }).manifestHash;
    expect(h0).not.toBe(h1);
  });
});
