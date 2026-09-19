import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";

export type ModalidadProcedimiento =
  | "LICITACION_PUBLICA"
  | "INVITACION_RESTRINGIDA"
  | "ADJUDICACION_DIRECTA";

export type TieBreakKey = "precio" | "fechaRecepcion" | "sorteo_documentado";

export type ProcedurePolicySnapshot = {
  id: number;
  regimeId: number;
  modalidad: ModalidadProcedimiento;
  criterioEvaluacion: string;
  modoEvaluacion: string;
  ponderacionTecnica: string | number;
  ponderacionEconomica: string | number;
  tieBreakPolicy: TieBreakKey[] | unknown;
  requisitos: unknown;
  actosObligatorios: string[] | unknown;
  version: number;
  hash: string;
};

export function parseTieBreakPolicy(raw: unknown): TieBreakKey[] {
  if (!Array.isArray(raw) || !raw.length) {
    return ["precio", "fechaRecepcion", "sorteo_documentado"];
  }
  const allowed: TieBreakKey[] = ["precio", "fechaRecepcion", "sorteo_documentado"];
  const out = raw.filter((x): x is TieBreakKey => allowed.includes(x as TieBreakKey));
  return out.length ? out : ["precio", "fechaRecepcion", "sorteo_documentado"];
}

export function parseActosObligatorios(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(String);
}

/** Hash of immutable policy body (excludes id/timestamps). */
export function hashProcedurePolicy(input: {
  regimeId: number;
  modalidad: string;
  criterioEvaluacion: string;
  modoEvaluacion: string;
  ponderacionTecnica: string | number;
  ponderacionEconomica: string | number;
  tieBreakPolicy: unknown;
  requisitos: unknown;
  actosObligatorios: unknown;
  version: number;
}): string {
  const payload = {
    regimeId: input.regimeId,
    modalidad: input.modalidad,
    criterioEvaluacion: input.criterioEvaluacion,
    modoEvaluacion: input.modoEvaluacion,
    ponderacionTecnica: Number(input.ponderacionTecnica).toFixed(2),
    ponderacionEconomica: Number(input.ponderacionEconomica).toFixed(2),
    tieBreakPolicy: input.tieBreakPolicy,
    requisitos: input.requisitos,
    actosObligatorios: input.actosObligatorios,
    version: input.version,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * At publish: lighter modalities must not require acts outside policy.actosObligatorios.
 * Feasible gate — ensure configured calendar acts ⊆ policy obligation set when provided.
 */
export function assertActosPermitidosPorPolitica(
  modalidad: ModalidadProcedimiento,
  actosObligatorios: string[],
  actosConfigurados: string[],
) {
  if (!actosObligatorios.length) return;
  const allowed = new Set(actosObligatorios);
  const extras = actosConfigurados.filter((a) => !allowed.has(a));
  // For lighter modalities, requiring JUNTA_ACLARACIONES when policy omits it is a gate failure.
  if (modalidad !== "LICITACION_PUBLICA") {
    const forbidden = actosConfigurados.filter((a) => a === "JUNTA_ACLARACIONES" && !allowed.has(a));
    if (forbidden.length) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `La modalidad ${modalidad} no exige JUNTA_ACLARACIONES según la ProcedurePolicy vigente.`,
      });
    }
  }
  if (extras.length && modalidad === "ADJUDICACION_DIRECTA") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `ADJUDICACION_DIRECTA solo admite actos de política: ${actosObligatorios.join(", ")}.`,
    });
  }
}

export function defaultPolicyForModalidad(modalidad: ModalidadProcedimiento): {
  actosObligatorios: string[];
  tieBreakPolicy: TieBreakKey[];
} {
  if (modalidad === "ADJUDICACION_DIRECTA") {
    return {
      actosObligatorios: ["EVALUACION", "DICTAMEN", "FALLO"],
      tieBreakPolicy: ["precio", "sorteo_documentado"],
    };
  }
  if (modalidad === "INVITACION_RESTRINGIDA") {
    return {
      actosObligatorios: ["RECEPCION", "APERTURA", "EVALUACION", "DICTAMEN", "FALLO"],
      tieBreakPolicy: ["precio", "fechaRecepcion", "sorteo_documentado"],
    };
  }
  return {
    actosObligatorios: ["JUNTA_ACLARACIONES", "RECEPCION", "APERTURA", "EVALUACION", "DICTAMEN", "FALLO"],
    tieBreakPolicy: ["precio", "fechaRecepcion", "sorteo_documentado"],
  };
}
