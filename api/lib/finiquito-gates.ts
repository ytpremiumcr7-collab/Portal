import { TRPCError } from "@trpc/server";

/** Incidencia severities that block finiquito while open. */
export const FINIQUITO_CRITICAL_INCIDENCIA_ESTADOS = ["ABIERTA", "EN_ANALISIS", "ACCION_CORRECTIVA", "ESCALADA"] as const;

/** Estimación states that must be cleared before finiquito (pending pipeline). */
export const FINIQUITO_PENDING_ESTIMACION_ESTADOS = ["PRESENTADA", "EN_REVISION", "AUTORIZADA"] as const;

/** Entregable states still pending acceptance. */
export const FINIQUITO_PENDING_ENTREGABLE_ESTADOS = ["PENDIENTE", "ENTREGADO"] as const;

/**
 * Garantía states compatible with finiquito.
 * Rules (documented): no REQUERIDA/PRESENTADA left open; VIGENTE/LIBERADA/EJECUTADA/VENCIDA OK
 * (vigente may cover post-termination warranty; liberada/ejecutada/vencida are terminal-ish).
 */
export const FINIQUITO_COMPATIBLE_GARANTIA_ESTADOS = ["VIGENTE", "LIBERADA", "EJECUTADA", "VENCIDA"] as const;
export const FINIQUITO_BLOCKING_GARANTIA_ESTADOS = ["REQUERIDA", "PRESENTADA"] as const;

/**
 * Financial reconciliation rule (explicit):
 * 1. Cumulative **montoBruto** of PAGADA estimaciones must reconcile vs contrato.monto
 *    (contrato.monto already reflects formalized modificaciones).
 * 2. Client **montoFinal** must match that computed cumulative bruto (not an arbitrary figure)
 *    within a tiny epsilon (default 0.01 MXN).
 * Net paid (montoNeto) is informational; the gate uses bruto as the recognized amount.
 */
export type FiniquitoGateInput = {
  criticalIncidenciasOpen: number;
  pendingEstimaciones: number;
  pendingEntregables: number;
  /** Sum of PAGADA estimaciones (montoBruto — recognized cumulative amount). */
  paidCumulativeBruto: number;
  /** Contrato monto (already adjusted by formalized modificaciones). */
  contratoMonto: number;
  /** Client-supplied finiquito montoFinal — must match paidCumulativeBruto. */
  montoFinal: number;
  /** Tolerance for floating reconciliation (default 0.01 MXN). */
  tolerance?: number;
  blockingGarantias: number;
};

export function evaluateFiniquitoGates(input: FiniquitoGateInput): string[] {
  const errors: string[] = [];
  if (input.criticalIncidenciasOpen > 0) {
    errors.push(`Hay ${input.criticalIncidenciasOpen} incidencia(s) crítica(s) abiertas.`);
  }
  if (input.pendingEstimaciones > 0) {
    errors.push(`Hay ${input.pendingEstimaciones} estimación(es) pendientes (PRESENTADA/EN_REVISION/AUTORIZADA).`);
  }
  if (input.pendingEntregables > 0) {
    errors.push(`Hay ${input.pendingEntregables} entregable(s) pendientes de aceptación.`);
  }
  const tol = input.tolerance ?? 0.01;
  if (Math.abs(input.paidCumulativeBruto - input.contratoMonto) > tol) {
    errors.push(
      `Pagos acumulados bruto (${input.paidCumulativeBruto.toFixed(2)}) no concilian con monto del contrato (${input.contratoMonto.toFixed(2)}).`,
    );
  }
  if (Math.abs(input.montoFinal - input.paidCumulativeBruto) > tol) {
    errors.push(
      `montoFinal (${input.montoFinal.toFixed(2)}) no concilia con el acumulado bruto reconocido (${input.paidCumulativeBruto.toFixed(2)}); no se aceptan montos arbitrarios del cliente.`,
    );
  }
  if (input.blockingGarantias > 0) {
    errors.push(
      `Hay ${input.blockingGarantias} garantía(s) en estado REQUERIDA/PRESENTADA; deben estar VIGENTE/LIBERADA/EJECUTADA/VENCIDA.`,
    );
  }
  return errors;
}

export function assertFiniquitoGates(input: FiniquitoGateInput) {
  const errors = evaluateFiniquitoGates(input);
  if (errors.length) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `No se puede emitir finiquito: ${errors.join(" ")}`,
    });
  }
}
