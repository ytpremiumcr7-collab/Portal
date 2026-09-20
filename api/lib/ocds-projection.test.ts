import { describe, expect, it } from "vitest";
import {
  buildOcdsRelease, assertNoPreAperturaBidMontos, isAperturaEconomiaPublica,
} from "./ocds-projection";

const baseProc = {
  id: 1, tenantId: 9, codigo: "LP-001", titulo: "Obra", objeto: "Construcción",
  estado: "PUBLICADA", tipoLicitacion: "PUBLICA", tipoContratacion: "OBRAS",
  montoPresupuestado: "1000000.00", fechaPublicacion: "2026-09-01", fechaCierre: "2026-09-30",
  createdAt: "2026-08-01",
};

describe("OCDS no pre-apertura monto", () => {
  it("isAperturaEconomiaPublica only after ABIERTA/PUBLICADA family", () => {
    expect(isAperturaEconomiaPublica(null)).toBe(false);
    expect(isAperturaEconomiaPublica("RECEPCION_ABIERTA")).toBe(false);
    expect(isAperturaEconomiaPublica("ABIERTA")).toBe(true);
    expect(isAperturaEconomiaPublica("PUBLICADA")).toBe(true);
  });

  it("redacts bid values before apertura", () => {
    const release = buildOcdsRelease({
      proc: baseProc,
      aperturaEstado: "RECEPCION_ABIERTA",
      bids: [{ id: 7, proveedorId: 3, montoOferta: "99999.99", date: "2026-09-10" }],
    });
    expect(release.bids?.details?.[0]?.value).toBeNull();
    expect(release.bids?.details?.[0]?.sealed).toBe(true);
    expect(release.meta.economiaOfertasPublica).toBe(false);
    expect(() => assertNoPreAperturaBidMontos(release)).not.toThrow();
    // Ensure the sealed amount string never appears in JSON
    expect(JSON.stringify(release)).not.toContain("99999.99");
  });

  it("reveals bid amounts only post-apertura", () => {
    const release = buildOcdsRelease({
      proc: baseProc,
      aperturaEstado: "ABIERTA",
      bids: [{ id: 7, proveedorId: 3, montoOferta: "12345.67" }],
    });
    expect(release.bids?.details?.[0]?.value).toEqual({ amount: 12345.67, currency: "MXN" });
    expect(release.meta.economiaOfertasPublica).toBe(true);
  });

  it("omits draft contracts; keeps budget (public tender value)", () => {
    const release = buildOcdsRelease({
      proc: baseProc,
      aperturaEstado: null,
      contract: {
        id: 1, folio: "C-DRAFT", estado: "BORRADOR", monto: "500.00",
        fechaInicio: null, fechaFin: null, fechaFirma: null,
      },
    });
    expect(release.contracts).toEqual([]);
    expect(release.tender.value?.amount).toBe(1000000);
  });

  it("includes formalized contract montos", () => {
    const release = buildOcdsRelease({
      proc: { ...baseProc, estado: "ADJUDICADA" },
      aperturaEstado: "PUBLICADA",
      award: { id: 2, publicadoAt: "2026-09-15", montoAdjudicado: "800000.00", proveedorGanadorId: 3 },
      contract: {
        id: 1, folio: "C-1", estado: "FORMALIZADO", monto: "800000.00",
        fechaInicio: "2026-10-01", fechaFin: "2027-10-01", fechaFirma: "2026-09-20",
      },
    });
    expect(release.contracts[0]?.value.amount).toBe(800000);
    expect(release.awards[0]?.value.amount).toBe(800000);
  });
});
