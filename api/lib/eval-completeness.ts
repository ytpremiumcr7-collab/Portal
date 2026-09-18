import { TRPCError } from "@trpc/server";

/** Final evaluation statuses (not PENDIENTE). */
export const FINAL_EVAL_ESTADOS = ["ADMISIBLE", "NO_ADMISIBLE", "RECHAZADA", "GANADORA", "DESCARTADA"] as const;

/**
 * Pre-dictamen / pre-fallo gate: every received proposición must have a final evaluation
 * status (not PENDIENTE). Block if any pending.
 */
export function assertEvaluacionesCompletas(
  offers: readonly { id: number; estadoEvaluacion: string }[],
) {
  const pending = offers.filter((o) => o.estadoEvaluacion === "PENDIENTE");
  if (pending.length) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Hay ${pending.length} proposición(es) con evaluación PENDIENTE; todas deben tener estado final antes de dictamen/fallo.`,
    });
  }
}
