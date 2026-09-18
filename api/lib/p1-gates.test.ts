import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { isOfertaDocumentalCompleta, assertOfertasDocumentalesCompletas } from "./oferta-completa";
import { evaluateFiniquitoGates, assertFiniquitoGates } from "./finiquito-gates";
import { assertGarantiaListaParaVigente, assertGarantiasRequeridasActivas } from "./garantia-gates";
import { findRoleConflict, assertNoRoleConflict, findCapabilityConflicts } from "./sod";
import { assertInvestigacionSancionTransition, canonicalImpedimentoActivo } from "./phase3-transitions";

function msg(fn: () => unknown) {
  try { fn(); return ""; } catch (e) { return e instanceof TRPCError ? e.message : String(e); }
}

describe("P1 oferta documental", () => {
  it("bare participación is incomplete", () => {
    expect(isOfertaDocumentalCompleta(1, [])).toBe(false);
  });
  it("requires tecnica + economica APROBADO vigente", () => {
    const docs = [
      { tipo: "OFERTA_TECNICA", proveedorId: 1, estado: "APROBADO", esVersionVigente: true },
      { tipo: "OFERTA_ECONOMICA", proveedorId: 1, estado: "APROBADO", esVersionVigente: true },
    ];
    expect(isOfertaDocumentalCompleta(1, docs)).toBe(true);
    expect(msg(() => assertOfertasDocumentalesCompletas([{ id: 9, proveedorId: 2 }], docs))).toContain("incompleta");
  });
});

describe("P1 finiquito gates", () => {
  it("blocks on open critical / pending / reconciliation / garantias", () => {
    const errors = evaluateFiniquitoGates({
      criticalIncidenciasOpen: 1, pendingEstimaciones: 0, pendingEntregables: 0,
      paidCumulative: 100, contratoMonto: 100, blockingGarantias: 0,
    });
    expect(errors.some((e) => e.includes("incidencia"))).toBe(true);
    expect(msg(() => assertFiniquitoGates({
      criticalIncidenciasOpen: 0, pendingEstimaciones: 0, pendingEntregables: 0,
      paidCumulative: 50, contratoMonto: 100, blockingGarantias: 0,
    }))).toContain("concilian");
  });
  it("passes when clean", () => {
    expect(() => assertFiniquitoGates({
      criticalIncidenciasOpen: 0, pendingEstimaciones: 0, pendingEntregables: 0,
      paidCumulative: 100, contratoMonto: 100, blockingGarantias: 0,
    })).not.toThrow();
  });
});

describe("P1 garantía gates", () => {
  it("requires fields before VIGENTE", () => {
    expect(msg(() => assertGarantiaListaParaVigente({
      tipo: "CUMPLIMIENTO", monto: "0", instrumento: null, numeroPoliza: null,
      fechaInicio: null, fechaVencimiento: null, documentoId: null,
    }))).toContain("incompleta");
  });
  it("contrato vigente requires all garantias VIGENTE when configured", () => {
    expect(msg(() => assertGarantiasRequeridasActivas([{ estado: "PRESENTADA" }]))).toContain("garantías activas");
    expect(() => assertGarantiasRequeridasActivas([{ estado: "VIGENTE" }])).not.toThrow();
    expect(() => assertGarantiasRequeridasActivas([])).not.toThrow();
  });
});

describe("SoD helpers", () => {
  it("detects role conflicts and allows justified override", () => {
    expect(findRoleConflict(["evaluador_tecnico"], "autorizador_fallo")).not.toBeNull();
    expect(msg(() => assertNoRoleConflict(["evaluador_tecnico"], "autorizador_fallo"))).toContain("incompatible");
    expect(() => assertNoRoleConflict(["evaluador_tecnico"], "autorizador_fallo", {
      override: true, justification: "Organización unipersonal con justificación",
    })).not.toThrow();
  });
  it("capability pair conflicts", () => {
    const caps = new Set(["presentar_pago", "aprobar_pago"]);
    expect(findCapabilityConflicts(caps, [
      { capabilityA: "presentar_pago", capabilityB: "aprobar_pago", motivo: "SoD" },
    ]).length).toBe(1);
  });
});

describe("Investigación sanción + impedimento canonical", () => {
  it("ABIERTA → EN_TRAMITE → cierre", () => {
    expect(() => assertInvestigacionSancionTransition("ABIERTA", "EN_TRAMITE")).not.toThrow();
    expect(() => assertInvestigacionSancionTransition("EN_TRAMITE", "CERRADA_SIN_SANCION")).not.toThrow();
    expect(msg(() => assertInvestigacionSancionTransition("CERRADA_SIN_SANCION", "EN_TRAMITE"))).toContain("terminal");
  });
  it("canonical activo from vigencia window", () => {
    expect(canonicalImpedimentoActivo({ vigenteDesde: "2020-01-01", vigenteHasta: "2099-01-01", asOf: "2026-09-18" })).toBe(true);
    expect(canonicalImpedimentoActivo({ vigenteDesde: "2020-01-01", vigenteHasta: "2020-02-01", asOf: "2026-09-18" })).toBe(false);
  });
});
