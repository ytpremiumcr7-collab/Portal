import { TRPCError } from "@trpc/server";

export type GarantiaPresentadaSnapshot = {
  tipo: string | null | undefined;
  monto: string | number | null | undefined;
  instrumento: string | null | undefined;
  numeroPoliza: string | null | undefined;
  fechaInicio: string | Date | null | undefined;
  fechaVencimiento: string | Date | null | undefined;
  documentoId?: number | null | undefined;
};

/** Require monto, vigencia window, tipo, instrumento/póliza and documento before VIGENTE. */
export function assertGarantiaListaParaVigente(g: GarantiaPresentadaSnapshot) {
  const missing: string[] = [];
  if (!g.tipo) missing.push("tipo");
  if (g.monto == null || Number(g.monto) <= 0) missing.push("monto>0");
  if (!g.instrumento?.toString().trim()) missing.push("instrumento");
  if (!g.numeroPoliza?.toString().trim()) missing.push("numeroPoliza");
  if (!g.fechaInicio) missing.push("fechaInicio");
  if (!g.fechaVencimiento) missing.push("fechaVencimiento");
  if (g.documentoId == null || Number(g.documentoId) <= 0) missing.push("documentoId");
  if (g.fechaInicio && g.fechaVencimiento) {
    const a = String(g.fechaInicio).slice(0, 10);
    const b = String(g.fechaVencimiento).slice(0, 10);
    if (b < a) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "fechaVencimiento debe ser ≥ fechaInicio.",
      });
    }
  }
  if (missing.length) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Garantía incompleta para activar (VIGENTE). Falta: ${missing.join(", ")}.`,
    });
  }
}

/**
 * Before contrato → VIGENTE: every REQUERIDA/PRESENTADA must already be VIGENTE
 * when the contract has required garantías configured (any rows exist).
 */
export function assertGarantiasRequeridasActivas(rows: Array<{ estado: string }>) {
  if (!rows.length) return; // none configured → no gate
  const notActive = rows.filter((r) => r.estado !== "VIGENTE" && r.estado !== "LIBERADA" && r.estado !== "EJECUTADA");
  // Required set must be VIGENTE (active) before contract vigency; LIBERADA/EJECUTADA alone don't satisfy "required active".
  const missingVigente = rows.filter((r) => r.estado !== "VIGENTE");
  // Rule: if any garantía was required, all must be VIGENTE to put contract VIGENTE.
  if (missingVigente.length) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `El contrato exige garantías activas (VIGENTE). Pendientes: ${missingVigente.length} de ${rows.length}.`,
    });
  }
  void notActive;
}
