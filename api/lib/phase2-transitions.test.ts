import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  assertAperturaTransition,
  assertAclaracionJuntaTransition,
  assertDictamenTransition,
  assertFalloTransition,
  assertContratoTransition,
  assertGarantiaTransition,
  assertAdjudicacionRequiresFallo,
  assertEvaluacionRequiresApertura,
  assertFalloRequiresDictamen,
  assertContratoRequiresAdjudicacion,
  APERTURA_FLOW,
} from "./phase2-transitions";

function msg(fn: () => unknown) {
  try { fn(); return ""; } catch (e) { return e instanceof TRPCError ? e.message : String(e); }
}

describe("Phase 2 — apertura gobernada", () => {
  it("permite el happy path completo", () => {
    for (let i = 0; i < APERTURA_FLOW.length - 1; i++) {
      expect(() => assertAperturaTransition(APERTURA_FLOW[i], APERTURA_FLOW[i + 1])).not.toThrow();
    }
  });
  it("bloquea saltos no autorizados", () => {
    expect(msg(() => assertAperturaTransition("RECEPCION_ABIERTA", "ABIERTA"))).toContain("Transición inválida");
    expect(msg(() => assertAperturaTransition("PUBLICADA", "SELLADA"))).toContain("Transición inválida");
  });
});

describe("Phase 2 — aclaraciones", () => {
  it("happy path junta", () => {
    expect(() => assertAclaracionJuntaTransition("PROGRAMADA", "ABIERTA")).not.toThrow();
    expect(() => assertAclaracionJuntaTransition("ABIERTA", "CERRADA_PREGUNTAS")).not.toThrow();
    expect(() => assertAclaracionJuntaTransition("CERRADA_PREGUNTAS", "EN_RESPUESTA")).not.toThrow();
    expect(() => assertAclaracionJuntaTransition("EN_RESPUESTA", "ACTA_EMITIDA")).not.toThrow();
    expect(() => assertAclaracionJuntaTransition("ACTA_EMITIDA", "PUBLICADA")).not.toThrow();
  });
  it("bloquea cancelar publicada", () => {
    expect(msg(() => assertAclaracionJuntaTransition("PUBLICADA", "CANCELADA"))).toContain("cancelar");
  });
});

describe("Phase 2 — dictamen / fallo / adjudicación", () => {
  it("dictamen emit→aprobar; bloquea aprobar desde borrador", () => {
    expect(() => assertDictamenTransition("BORRADOR", "EMITIDO")).not.toThrow();
    expect(() => assertDictamenTransition("EMITIDO", "APROBADO")).not.toThrow();
    expect(msg(() => assertDictamenTransition("BORRADOR", "APROBADO"))).toContain("Transición inválida");
  });
  it("fallo emitir→aprobar→publicar", () => {
    expect(() => assertFalloTransition("BORRADOR", "EMITIDO")).not.toThrow();
    expect(() => assertFalloTransition("EMITIDO", "APROBADO")).not.toThrow();
    expect(() => assertFalloTransition("APROBADO", "PUBLICADO")).not.toThrow();
    expect(msg(() => assertFalloTransition("BORRADOR", "PUBLICADO"))).toContain("Transición inválida");
  });
  it("adjudicación exige dictamen aprobado + fallo publicado alineado", () => {
    expect(msg(() => assertAdjudicacionRequiresFallo({
      falloEstado: null, falloSentido: null, falloProveedorId: null, falloMonto: null,
      proveedorGanadorId: 1, montoAdjudicado: "100", dictamenEstado: null,
    }))).toContain("dictamen APROBADO");
    expect(msg(() => assertAdjudicacionRequiresFallo({
      falloEstado: "EMITIDO", falloSentido: "ADJUDICAR", falloProveedorId: 1, falloMonto: "100",
      proveedorGanadorId: 1, montoAdjudicado: "100", dictamenEstado: "APROBADO",
    }))).toContain("fallo PUBLICADO");
    expect(() => assertAdjudicacionRequiresFallo({
      falloEstado: "PUBLICADO", falloSentido: "ADJUDICAR", falloProveedorId: 1, falloMonto: "100.00",
      proveedorGanadorId: 1, montoAdjudicado: "100.00", dictamenEstado: "APROBADO",
    })).not.toThrow();
  });
  it("fallo exige dictamen alineado", () => {
    expect(msg(() => assertFalloRequiresDictamen(null, "ADJUDICAR", 1, "10"))).toContain("dictamen APROBADO");
    expect(() => assertFalloRequiresDictamen({
      estado: "APROBADO", resultado: "RECOMENDAR_ADJUDICACION", proveedorRecomendadoId: 5, montoRecomendado: "200",
    }, "ADJUDICAR", 5, "200")).not.toThrow();
  });
  it("evaluación exige apertura publicada", () => {
    expect(msg(() => assertEvaluacionRequiresApertura("SELLADA"))).toContain("apertura gobernada PUBLICADA");
    expect(() => assertEvaluacionRequiresApertura("PUBLICADA")).not.toThrow();
  });
});

describe("Phase 2 — contrato / garantía", () => {
  it("contrato y garantía happy + blocked", () => {
    expect(() => assertContratoTransition("BORRADOR", "FORMALIZADO")).not.toThrow();
    expect(msg(() => assertContratoTransition("BORRADOR", "VIGENTE"))).toContain("Transición inválida");
    expect(() => assertGarantiaTransition("REQUERIDA", "PRESENTADA")).not.toThrow();
    expect(msg(() => assertGarantiaTransition("REQUERIDA", "LIBERADA"))).toContain("Transición inválida");
    expect(() => assertContratoRequiresAdjudicacion("ADJUDICADA", "PUBLICADO")).not.toThrow();
    expect(msg(() => assertContratoRequiresAdjudicacion("EN_EVALUACION", "PUBLICADO"))).toContain("ADJUDICADA");
  });
});
