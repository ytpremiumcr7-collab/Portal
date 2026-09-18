import { TRPCError } from "@trpc/server";

function advanceLinear<T extends string>(flow: readonly T[], current: T, next: T, label: string) {
  const i = flow.indexOf(current);
  const j = flow.indexOf(next);
  if (i < 0 || j !== i + 1) {
    throw new TRPCError({ code: "CONFLICT", message: `Transición inválida de ${label}: ${current} → ${next}.` });
  }
}

export const NECESIDAD_FLOW = ["BORRADOR", "EN_REVISION", "APROBADA"] as const;
export type NecesidadEstado = typeof NECESIDAD_FLOW[number] | "RECHAZADA" | "VINCULADA";

export const INV_MERCADO_FLOW = ["BORRADOR", "EN_CONSULTA", "CERRADA", "CONCLUIDA"] as const;
export type InvMercadoEstado = typeof INV_MERCADO_FLOW[number] | "CANCELADA";

export const MOD_CONTRATO_FLOW = ["BORRADOR", "EN_REVISION", "APROBADA", "FORMALIZADA"] as const;
export type ModContratoEstado = typeof MOD_CONTRATO_FLOW[number] | "RECHAZADA";

export const EJECUCION_FLOW = ["NO_INICIADA", "EN_EJECUCION", "TERMINADA", "FINIQUITADA"] as const;
export type EjecucionEstado = typeof EJECUCION_FLOW[number] | "SUSPENDIDA";

export const ESTIMACION_FLOW = ["PRESENTADA", "EN_REVISION", "AUTORIZADA", "PAGADA"] as const;
export type EstimacionEstado = typeof ESTIMACION_FLOW[number] | "RECHAZADA";

export const INCIDENCIA_FLOW = ["ABIERTA", "EN_ANALISIS", "ACCION_CORRECTIVA", "RESUELTA", "CERRADA"] as const;
export type IncidenciaEstado = typeof INCIDENCIA_FLOW[number] | "ESCALADA";

export const SANCION_FLOW = ["BORRADOR", "EMITIDA", "VIGENTE", "CUMPLIDA"] as const;
export type SancionEstado = typeof SANCION_FLOW[number] | "REVOCADA";

export const INCONFORMIDAD_FLOW = ["PRESENTADA", "ADMITIDA", "EN_TRAMITE", "RESUELTA"] as const;
export type InconformidadEstado = typeof INCONFORMIDAD_FLOW[number] | "DESECHADA" | "SOBRESEIDA";

export function assertNecesidadTransition(from: NecesidadEstado, to: NecesidadEstado) {
  if (to === "RECHAZADA") {
    if (!["BORRADOR", "EN_REVISION"].includes(from)) throw new TRPCError({ code: "CONFLICT", message: "Sólo borrador/revisión pueden rechazarse." });
    return;
  }
  if (to === "VINCULADA") {
    if (from !== "APROBADA") throw new TRPCError({ code: "CONFLICT", message: "Sólo una necesidad APROBADA puede vincularse a procedimiento." });
    return;
  }
  if (from === "RECHAZADA" || from === "VINCULADA") throw new TRPCError({ code: "CONFLICT", message: `Necesidad en estado terminal ${from}.` });
  advanceLinear(NECESIDAD_FLOW as readonly string[], from, to, "necesidad");
}

export function assertInvMercadoTransition(from: InvMercadoEstado, to: InvMercadoEstado) {
  if (to === "CANCELADA") {
    if (from === "CONCLUIDA" || from === "CANCELADA") throw new TRPCError({ code: "CONFLICT", message: "No se puede cancelar." });
    return;
  }
  if (from === "CANCELADA") throw new TRPCError({ code: "CONFLICT", message: "Investigación cancelada." });
  advanceLinear(INV_MERCADO_FLOW as readonly string[], from, to, "investigación de mercado");
}

export function assertModContratoTransition(from: ModContratoEstado, to: ModContratoEstado) {
  if (to === "RECHAZADA") {
    if (!["BORRADOR", "EN_REVISION"].includes(from)) throw new TRPCError({ code: "CONFLICT", message: "Sólo borrador/revisión pueden rechazarse." });
    return;
  }
  if (from === "RECHAZADA") throw new TRPCError({ code: "CONFLICT", message: "Modificación rechazada." });
  advanceLinear(MOD_CONTRATO_FLOW as readonly string[], from, to, "modificación contractual");
}

export function assertEjecucionTransition(from: EjecucionEstado, to: EjecucionEstado) {
  if (to === "SUSPENDIDA") {
    if (from !== "EN_EJECUCION") throw new TRPCError({ code: "CONFLICT", message: "Sólo ejecución en curso puede suspenderse." });
    return;
  }
  if (from === "SUSPENDIDA" && to === "EN_EJECUCION") return;
  if (from === "SUSPENDIDA") throw new TRPCError({ code: "CONFLICT", message: "Reanude la ejecución antes de continuar." });
  advanceLinear(EJECUCION_FLOW as readonly string[], from, to, "ejecución contractual");
}

export function assertEstimacionTransition(from: EstimacionEstado, to: EstimacionEstado) {
  if (to === "RECHAZADA") {
    if (!["PRESENTADA", "EN_REVISION"].includes(from)) throw new TRPCError({ code: "CONFLICT", message: "Sólo presentada/en revisión pueden rechazarse." });
    return;
  }
  if (from === "RECHAZADA") throw new TRPCError({ code: "CONFLICT", message: "Estimación rechazada." });
  advanceLinear(ESTIMACION_FLOW as readonly string[], from, to, "estimación/pago");
}

export function assertIncidenciaTransition(from: IncidenciaEstado, to: IncidenciaEstado) {
  if (to === "ESCALADA") {
    if (!["ABIERTA", "EN_ANALISIS", "ACCION_CORRECTIVA"].includes(from)) throw new TRPCError({ code: "CONFLICT", message: "No se puede escalar desde este estado." });
    return;
  }
  if (from === "ESCALADA" && to === "EN_ANALISIS") return;
  if (from === "ESCALADA") throw new TRPCError({ code: "CONFLICT", message: "Incidencia escalada: retome análisis." });
  advanceLinear(INCIDENCIA_FLOW as readonly string[], from, to, "incidencia");
}

export function assertSancionTransition(from: SancionEstado, to: SancionEstado) {
  if (to === "REVOCADA") {
    if (!["EMITIDA", "VIGENTE"].includes(from)) throw new TRPCError({ code: "CONFLICT", message: "Sólo emitida/vigente pueden revocarse." });
    return;
  }
  if (from === "REVOCADA") throw new TRPCError({ code: "CONFLICT", message: "Sanción revocada." });
  advanceLinear(SANCION_FLOW as readonly string[], from, to, "sanción");
}

export function assertInconformidadTransition(from: InconformidadEstado, to: InconformidadEstado) {
  if (to === "DESECHADA" || to === "SOBRESEIDA") {
    if (!["PRESENTADA", "ADMITIDA", "EN_TRAMITE"].includes(from)) throw new TRPCError({ code: "CONFLICT", message: `No se puede pasar a ${to} desde ${from}.` });
    return;
  }
  if (from === "DESECHADA" || from === "SOBRESEIDA") throw new TRPCError({ code: "CONFLICT", message: "Inconformidad cerrada." });
  advanceLinear(INCONFORMIDAD_FLOW as readonly string[], from, to, "inconformidad");
}

/** Gate: proveedor impedido no puede participar ni ser adjudicado. ALERTA ≠ SANCIÓN. */
export function assertProveedorNoImpedido(impedimentoActivo: boolean, contexto: "participacion" | "adjudicacion") {
  if (impedimentoActivo) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: contexto === "participacion"
        ? "El proveedor está impedido/sancionado vigente; no puede presentar oferta."
        : "El proveedor está impedido/sancionado vigente; no puede adjudicar.",
    });
  }
}

export function assertSuficienciaParaVincular(suficienciaEstado: string | null | undefined) {
  if (suficienciaEstado !== "OTORGADA" && suficienciaEstado !== "COMPROMETIDA") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Se requiere suficiencia presupuestaria OTORGADA (o ya comprometida) para vincular la necesidad a un procedimiento.",
    });
  }
}
