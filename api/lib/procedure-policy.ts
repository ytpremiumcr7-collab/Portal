import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { legalRegimes, procedurePolicies } from "@db/schema";

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

export type PolicyRequisitos = {
  ofertaTecnica?: boolean;
  ofertaEconomica?: boolean;
  garantiaSeriedad?: boolean;
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

export function parseRequisitos(raw: unknown): PolicyRequisitos {
  if (!raw || typeof raw !== "object") return {};
  return raw as PolicyRequisitos;
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
 * Compare policy.actosObligatorios vs configured/hitos of the procedure.
 * - Missing required actos → fail
 * - Extra acts forbidden on lighter modalities (IR/AD) → fail
 */
export function assertActosPermitidosPorPolitica(
  modalidad: ModalidadProcedimiento,
  actosObligatorios: string[],
  actosConfigurados: string[],
) {
  if (!actosObligatorios.length) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "La ProcedurePolicy no define actosObligatorios; no se puede publicar.",
    });
  }
  const allowed = new Set(actosObligatorios);
  const configured = new Set(actosConfigurados);

  const missing = actosObligatorios.filter((a) => {
    // RECEPCION/APERTURA/EVALUACION/DICTAMEN/FALLO are procedural machine states —
    // only calendar/hito-configured acts (e.g. JUNTA_ACLARACIONES) must be present as hitos.
    if (a === "JUNTA_ACLARACIONES") return !configured.has(a);
    return false;
  });
  if (missing.length) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Faltan actos obligatorios de política configurados: ${missing.join(", ")}.`,
    });
  }

  const extras = actosConfigurados.filter((a) => !allowed.has(a));
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

/** OBRA → LOPSRM; else LAASSP. */
export function regimeCodeFromContratacion(tipoContratacion: string): "LAASSP" | "LOPSRM" {
  return tipoContratacion === "OBRA" ? "LOPSRM" : "LAASSP";
}

/**
 * Select ProcedurePolicy by modalidad AND regime matching expediente/marco,
 * prefer highest version. Fail if none found (policy required).
 */
export async function resolvePolicyForPublish(
  db: any,
  opts: { modalidad: ModalidadProcedimiento; tipoContratacion: string; marcoJuridico?: string | null },
): Promise<ProcedurePolicySnapshot> {
  const code = (opts.marcoJuridico === "LOPSRM" || opts.marcoJuridico === "LAASSP"
    ? opts.marcoJuridico
    : regimeCodeFromContratacion(opts.tipoContratacion)) as "LAASSP" | "LOPSRM";

  const regime = await db.query.legalRegimes.findFirst({
    where: and(eq(legalRegimes.code, code), eq(legalRegimes.activa, true)),
  });
  if (!regime) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Régimen jurídico ${code} no encontrado o inactivo.`,
    });
  }

  const policy = await db.query.procedurePolicies.findFirst({
    where: and(
      eq(procedurePolicies.regimeId, regime.id),
      eq(procedurePolicies.modalidad, opts.modalidad),
    ),
    orderBy: [desc(procedurePolicies.version)],
  });
  if (!policy) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `No hay ProcedurePolicy para modalidad ${opts.modalidad} bajo régimen ${code}. La publicación requiere política.`,
    });
  }
  return policy as ProcedurePolicySnapshot;
}

export function policyRequiresJunta(actosObligatorios: string[]): boolean {
  return actosObligatorios.includes("JUNTA_ACLARACIONES");
}
