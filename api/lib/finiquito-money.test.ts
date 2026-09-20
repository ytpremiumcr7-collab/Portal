import { describe, expect, it } from "vitest";
import { evaluateFiniquitoGates, assertFiniquitoGates } from "./finiquito-gates";
import { moneyAdd, moneyFixed2 } from "./money";
import { TRPCError } from "@trpc/server";

function msg(fn: () => unknown) {
  try { fn(); return ""; } catch (e) { return e instanceof TRPCError ? e.message : String(e); }
}

describe("finiquito money compare (decimal)", () => {
  it("accepts awkward decimals that IEEE Number would mis-sum", () => {
    // 0.1 + 0.2 as strings via moneyAdd → 0.30; gate must reconcile vs contrato
    const bruto = moneyFixed2(moneyAdd("0.1", "0.2"));
    expect(bruto).toBe("0.30");
    expect(() => assertFiniquitoGates({
      criticalIncidenciasOpen: 0, pendingEstimaciones: 0, pendingEntregables: 0,
      paidCumulativeBruto: bruto, contratoMonto: "0.30", montoFinal: "0.30", blockingGarantias: 0,
    })).not.toThrow();
  });

  it("rejects float-trap style mismatch within string path", () => {
    // Classic: Number(0.1+0.2) !== 0.3 but decimal strings equal when fixed
    const errors = evaluateFiniquitoGates({
      criticalIncidenciasOpen: 0, pendingEstimaciones: 0, pendingEntregables: 0,
      paidCumulativeBruto: "100.00", contratoMonto: "100.00", montoFinal: "99.98", blockingGarantias: 0,
    });
    expect(errors.some((e) => e.includes("montoFinal"))).toBe(true);
  });

  it("tolerance 0.01 allows one-cent rounding", () => {
    expect(() => assertFiniquitoGates({
      criticalIncidenciasOpen: 0, pendingEstimaciones: 0, pendingEntregables: 0,
      paidCumulativeBruto: "100.00", contratoMonto: "100.005", montoFinal: "100.00",
      tolerance: "0.01", blockingGarantias: 0,
    })).not.toThrow();
  });

  it("blocks when bruto vs contrato diverge beyond tolerance", () => {
    expect(msg(() => assertFiniquitoGates({
      criticalIncidenciasOpen: 0, pendingEstimaciones: 0, pendingEntregables: 0,
      paidCumulativeBruto: "50.00", contratoMonto: "100.00", montoFinal: "50.00", blockingGarantias: 0,
    }))).toMatch(/concilian/);
  });
});
