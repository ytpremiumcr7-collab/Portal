import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  assertNecesidadTransition,
  assertInvMercadoTransition,
  assertModContratoTransition,
  assertEjecucionTransition,
  assertEstimacionTransition,
  assertIncidenciaTransition,
  assertSancionTransition,
  assertInconformidadTransition,
  assertProveedorNoImpedido,
  assertSuficienciaParaVincular,
  ESTIMACION_FLOW,
} from "./phase3-transitions";

function msg(fn: () => unknown) {
  try { fn(); return ""; } catch (e) { return e instanceof TRPCError ? e.message : String(e); }
}

describe("Phase 3 — planeación", () => {
  it("necesidad happy path + vincular", () => {
    expect(() => assertNecesidadTransition("BORRADOR", "EN_REVISION")).not.toThrow();
    expect(() => assertNecesidadTransition("EN_REVISION", "APROBADA")).not.toThrow();
    expect(() => assertNecesidadTransition("APROBADA", "VINCULADA")).not.toThrow();
    expect(msg(() => assertNecesidadTransition("BORRADOR", "APROBADA"))).toContain("Transición inválida");
    expect(msg(() => assertNecesidadTransition("BORRADOR", "VINCULADA"))).toContain("APROBADA");
  });
  it("suficiencia gate", () => {
    expect(msg(() => assertSuficienciaParaVincular("SOLICITADA"))).toContain("suficiencia");
    expect(() => assertSuficienciaParaVincular("OTORGADA")).not.toThrow();
  });
});

describe("Phase 3 — investigación mercado", () => {
  it("consulta → cierre → conclusión", () => {
    expect(() => assertInvMercadoTransition("BORRADOR", "EN_CONSULTA")).not.toThrow();
    expect(() => assertInvMercadoTransition("EN_CONSULTA", "CERRADA")).not.toThrow();
    expect(() => assertInvMercadoTransition("CERRADA", "CONCLUIDA")).not.toThrow();
    expect(msg(() => assertInvMercadoTransition("BORRADOR", "CONCLUIDA"))).toContain("Transición inválida");
  });
});

describe("Phase 3 — ejecución / pagos", () => {
  it("modificación y ejecución", () => {
    expect(() => assertModContratoTransition("BORRADOR", "EN_REVISION")).not.toThrow();
    expect(() => assertModContratoTransition("EN_REVISION", "APROBADA")).not.toThrow();
    expect(() => assertModContratoTransition("APROBADA", "FORMALIZADA")).not.toThrow();
    expect(() => assertEjecucionTransition("NO_INICIADA", "EN_EJECUCION")).not.toThrow();
    expect(() => assertEjecucionTransition("EN_EJECUCION", "SUSPENDIDA")).not.toThrow();
    expect(() => assertEjecucionTransition("SUSPENDIDA", "EN_EJECUCION")).not.toThrow();
    expect(msg(() => assertEjecucionTransition("NO_INICIADA", "TERMINADA"))).toContain("Transición inválida");
    expect(msg(() => assertEjecucionTransition("TERMINADA", "FINIQUITADA"))).toContain("emitirFiniquito");
  });
  it("estimación presentar→revisar→autorizar→pagar", () => {
    for (let i = 0; i < ESTIMACION_FLOW.length - 1; i++) {
      expect(() => assertEstimacionTransition(ESTIMACION_FLOW[i], ESTIMACION_FLOW[i + 1])).not.toThrow();
    }
    expect(msg(() => assertEstimacionTransition("PRESENTADA", "PAGADA"))).toContain("Transición inválida");
    expect(() => assertEstimacionTransition("PRESENTADA", "RECHAZADA")).not.toThrow();
  });
});

describe("Phase 3 — incidencias / sanciones / inconformidades", () => {
  it("incidencia flow", () => {
    expect(() => assertIncidenciaTransition("ABIERTA", "EN_ANALISIS")).not.toThrow();
    expect(() => assertIncidenciaTransition("EN_ANALISIS", "ACCION_CORRECTIVA")).not.toThrow();
    expect(() => assertIncidenciaTransition("ACCION_CORRECTIVA", "RESUELTA")).not.toThrow();
    expect(() => assertIncidenciaTransition("ABIERTA", "ESCALADA")).not.toThrow();
  });
  it("sanción ≠ alerta; impedimento gate", () => {
    expect(() => assertSancionTransition("BORRADOR", "EMITIDA")).not.toThrow();
    expect(() => assertSancionTransition("EMITIDA", "VIGENTE")).not.toThrow();
    expect(msg(() => assertProveedorNoImpedido(true, "participacion"))).toContain("impedido");
    expect(msg(() => assertProveedorNoImpedido(true, "adjudicacion"))).toContain("impedido");
    expect(() => assertProveedorNoImpedido(false, "participacion")).not.toThrow();
  });
  it("inconformidad", () => {
    expect(() => assertInconformidadTransition("PRESENTADA", "ADMITIDA")).not.toThrow();
    expect(() => assertInconformidadTransition("ADMITIDA", "EN_TRAMITE")).not.toThrow();
    expect(() => assertInconformidadTransition("EN_TRAMITE", "RESUELTA")).not.toThrow();
    expect(() => assertInconformidadTransition("PRESENTADA", "DESECHADA")).not.toThrow();
  });
});
