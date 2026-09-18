import { TRPCError } from "@trpc/server";

/** Pure transition guards for Phase 2 domains — unit-testable without DB. */

export const APERTURA_FLOW = [
  "RECEPCION_ABIERTA",
  "RECEPCION_CERRADA",
  "SELLADA",
  "ABIERTA",
  "REGISTRADA",
  "ACTA_EMITIDA",
  "PUBLICADA",
] as const;
export type AperturaEstado = typeof APERTURA_FLOW[number];

export const ACLARACION_JUNTA_FLOW = [
  "PROGRAMADA",
  "ABIERTA",
  "CERRADA_PREGUNTAS",
  "EN_RESPUESTA",
  "ACTA_EMITIDA",
  "PUBLICADA",
] as const;
export type AclaracionJuntaEstado = typeof ACLARACION_JUNTA_FLOW[number] | "CANCELADA";

export const DICTAMEN_FLOW = ["BORRADOR", "EMITIDO", "APROBADO"] as const;
export type DictamenEstado = typeof DICTAMEN_FLOW[number] | "RECHAZADO";

export const FALLO_FLOW = ["BORRADOR", "EMITIDO", "APROBADO", "PUBLICADO"] as const;
export type FalloEstado = typeof FALLO_FLOW[number];

export const CONTRATO_FLOW = ["BORRADOR", "FORMALIZADO", "VIGENTE", "TERMINADO"] as const;
export type ContratoEstado = typeof CONTRATO_FLOW[number] | "RESCINDIDO";

export const GARANTIA_FLOW = ["REQUERIDA", "PRESENTADA", "VIGENTE", "LIBERADA"] as const;
export type GarantiaEstado = typeof GARANTIA_FLOW[number] | "EJECUTADA" | "VENCIDA";

function advanceLinear<T extends string>(flow: readonly T[], current: T, next: T, label: string) {
  const i = flow.indexOf(current);
  const j = flow.indexOf(next);
  if (i < 0 || j !== i + 1) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Transición inválida de ${label}: ${current} → ${next}.`,
    });
  }
}

export function assertAperturaTransition(from: AperturaEstado, to: AperturaEstado) {
  advanceLinear(APERTURA_FLOW, from, to, "apertura");
}

export function assertAclaracionJuntaTransition(from: AclaracionJuntaEstado, to: AclaracionJuntaEstado) {
  if (to === "CANCELADA") {
    if (from === "PUBLICADA" || from === "CANCELADA") {
      throw new TRPCError({ code: "CONFLICT", message: `No se puede cancelar una junta en estado ${from}.` });
    }
    return;
  }
  if (from === "CANCELADA") {
    throw new TRPCError({ code: "CONFLICT", message: "La junta está cancelada." });
  }
  advanceLinear(ACLARACION_JUNTA_FLOW as readonly string[], from, to, "junta de aclaraciones");
}

export function assertDictamenTransition(from: DictamenEstado, to: DictamenEstado) {
  if (to === "RECHAZADO") {
    if (from !== "EMITIDO") throw new TRPCError({ code: "CONFLICT", message: "Sólo un dictamen EMITIDO puede rechazarse." });
    return;
  }
  if (from === "RECHAZADO") throw new TRPCError({ code: "CONFLICT", message: "El dictamen fue rechazado; cree una nueva versión." });
  advanceLinear(DICTAMEN_FLOW as readonly string[], from, to, "dictamen");
}

export function assertFalloTransition(from: FalloEstado, to: FalloEstado) {
  advanceLinear(FALLO_FLOW, from, to, "fallo");
}

export function assertContratoTransition(from: ContratoEstado, to: ContratoEstado) {
  if (to === "RESCINDIDO") {
    if (!["FORMALIZADO", "VIGENTE"].includes(from)) {
      throw new TRPCError({ code: "CONFLICT", message: "Sólo un contrato formalizado/vigente puede rescindirse." });
    }
    return;
  }
  if (from === "RESCINDIDO") throw new TRPCError({ code: "CONFLICT", message: "El contrato está rescindido." });
  advanceLinear(CONTRATO_FLOW as readonly string[], from, to, "contrato");
}

export function assertGarantiaTransition(from: GarantiaEstado, to: GarantiaEstado) {
  if (to === "EJECUTADA" || to === "VENCIDA") {
    if (!["PRESENTADA", "VIGENTE"].includes(from)) {
      throw new TRPCError({ code: "CONFLICT", message: `No se puede pasar a ${to} desde ${from}.` });
    }
    return;
  }
  advanceLinear(GARANTIA_FLOW as readonly string[], from, to, "garantía");
}

/** Adjudicación requires published fallo that matches the winner and amount. */
export function assertAdjudicacionRequiresFallo(input: {
  falloEstado: string | null | undefined;
  falloSentido: string | null | undefined;
  falloProveedorId: number | null | undefined;
  falloMonto: string | number | null | undefined;
  proveedorGanadorId: number;
  montoAdjudicado: string | number;
  dictamenEstado: string | null | undefined;
}) {
  if (input.dictamenEstado !== "APROBADO") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Se requiere un dictamen APROBADO antes de adjudicar." });
  }
  if (input.falloEstado !== "PUBLICADO") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Se requiere un fallo PUBLICADO antes de adjudicar." });
  }
  if (input.falloSentido !== "ADJUDICAR") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El fallo publicado no tiene sentido ADJUDICAR." });
  }
  if (Number(input.falloProveedorId) !== Number(input.proveedorGanadorId)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El proveedor adjudicado debe coincidir con el fallo publicado." });
  }
  if (Number(input.falloMonto) !== Number(input.montoAdjudicado)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El monto adjudicado debe coincidir con el fallo publicado." });
  }
}

export function assertEvaluacionRequiresApertura(aperturaEstado: string | null | undefined) {
  if (aperturaEstado !== "PUBLICADA") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Se requiere apertura gobernada PUBLICADA (cierre → sello → apertura → registro → acta → publicación) antes de evaluar.",
    });
  }
}

export function assertFalloRequiresDictamen(dictamen: {
  estado: string;
  resultado: string | null;
  proveedorRecomendadoId: number | null;
  montoRecomendado: string | number | null;
} | null, sentido: string, proveedorId?: number | null, monto?: string | number | null) {
  if (!dictamen || dictamen.estado !== "APROBADO") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El fallo requiere un dictamen APROBADO." });
  }
  if (sentido === "ADJUDICAR") {
    if (dictamen.resultado !== "RECOMENDAR_ADJUDICACION") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El dictamen no recomienda adjudicación." });
    }
    if (Number(dictamen.proveedorRecomendadoId) !== Number(proveedorId)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El proveedor del fallo debe coincidir con el dictamen." });
    }
    if (Number(dictamen.montoRecomendado) !== Number(monto)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El monto del fallo debe coincidir con el dictamen." });
    }
  }
}

export function assertContratoRequiresAdjudicacion(licEstado: string, falloEstado: string | null | undefined) {
  if (licEstado !== "ADJUDICADA") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El contrato sólo se crea sobre una licitación ADJUDICADA." });
  }
  if (falloEstado !== "PUBLICADO") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El contrato requiere fallo PUBLICADO." });
  }
}
