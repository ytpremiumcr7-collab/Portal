import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { legalRegimes, procedurePolicies } from "@db/schema";

/**
 * LAASSP art. 35 procedure types (catalog).
 * INVITACION_RESTRINGIDA retained as legacy alias of INVITACION_TRES.
 * Workflow specialization MVP: LP / ITP / AD. Others exist in catalog with
 * gates that refuse unsupported transitions rather than silent wrong LP flow.
 */
export type ModalidadProcedimiento =
  | "LICITACION_PUBLICA"
  | "INVITACION_RESTRINGIDA"
  | "INVITACION_TRES"
  | "ADJUDICACION_DIRECTA"
  | "DIALOGO_COMPETITIVO"
  | "ADJUDICACION_DIRECTA_NEGOCIACION"
  | "ACUERDO_MARCO_ASIGNACION"
  | "TIENDA_DIGITAL_ORDEN";

export const LAASSP_MODALIDADES: readonly ModalidadProcedimiento[] = [
  "LICITACION_PUBLICA",
  "INVITACION_TRES",
  "ADJUDICACION_DIRECTA",
  "DIALOGO_COMPETITIVO",
  "ADJUDICACION_DIRECTA_NEGOCIACION",
  "ACUERDO_MARCO_ASIGNACION",
  "TIENDA_DIGITAL_ORDEN",
] as const;

/** Modalities whose full workflow is MVP-supported (LP/ITP/AD). */
export const WORKFLOW_SUPPORTED_MODALIDADES: ReadonlySet<ModalidadProcedimiento> = new Set([
  "LICITACION_PUBLICA",
  "INVITACION_RESTRINGIDA",
  "INVITACION_TRES",
  "ADJUDICACION_DIRECTA",
]);

/** IV/V — Hacienda / Comité constrained (policy metadata). */
export const HACIENDA_COMITE_CONSTRAINED: ReadonlySet<ModalidadProcedimiento> = new Set([
  "DIALOGO_COMPETITIVO",
  "ADJUDICACION_DIRECTA_NEGOCIACION",
]);

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
  constrainedBy?: string;
  workflowSupported?: boolean;
  aliasOf?: string;
  /** Modalities IV/V — Comité / Hacienda authorization */
  autorizacionComiteRef?: string;
  autorizadoPorHacienda?: boolean | string;
  /** Acuerdo marco */
  acuerdoMarcoId?: string;
  acuerdoMarcoRef?: string;
  skipConvocatoriaPublica?: boolean;
  /** Tienda digital */
  tiendaCatalogoRef?: string;
  ordenCompraRef?: string;
  refuseFullLpPresentacion?: boolean;
  /** ADN — notes required before fallo */
  notasNegociacion?: string;
  requiresAuthMeta?: boolean;
  requiresAcuerdoMarcoRef?: boolean;
  requiresTiendaOrdenRef?: boolean;
  workflowMvp?: string;
  /** Require CRYPTO_SIGNATURE / e.firma for proposición present */
  requiereFirmaElectronicaAvanzada?: boolean;
  requireCryptoSignature?: boolean;
};

/** Merge catalog policy requisitos with procedure-level modalidadMeta. */
export function mergeModalidadRequisitos(
  policyRequisitos: unknown,
  modalidadMeta?: unknown,
): PolicyRequisitos {
  const base = parseRequisitos(policyRequisitos);
  if (!modalidadMeta || typeof modalidadMeta !== "object") return base;
  return { ...base, ...(modalidadMeta as PolicyRequisitos) };
}

export function normalizeModalidad(modalidad: string): ModalidadProcedimiento {
  if (modalidad === "INVITACION_RESTRINGIDA") return "INVITACION_TRES";
  return modalidad as ModalidadProcedimiento;
}

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
  const isLp = modalidad === "LICITACION_PUBLICA";
  if (!isLp) {
    const forbidden = actosConfigurados.filter((a) => a === "JUNTA_ACLARACIONES" && !allowed.has(a));
    if (forbidden.length) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `La modalidad ${modalidad} no exige JUNTA_ACLARACIONES según la ProcedurePolicy vigente.`,
      });
    }
  }
  if (extras.length && (modalidad === "ADJUDICACION_DIRECTA" || modalidad === "ADJUDICACION_DIRECTA_NEGOCIACION")) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${modalidad} solo admite actos de política: ${actosObligatorios.join(", ")}.`,
    });
  }
}

export function defaultPolicyForModalidad(modalidad: ModalidadProcedimiento): {
  actosObligatorios: string[];
  tieBreakPolicy: TieBreakKey[];
} {
  const m = normalizeModalidad(modalidad);
  if (m === "ADJUDICACION_DIRECTA" || m === "ADJUDICACION_DIRECTA_NEGOCIACION") {
    return {
      actosObligatorios: ["EVALUACION", "DICTAMEN", "FALLO"],
      tieBreakPolicy: ["precio", "sorteo_documentado"],
    };
  }
  if (m === "INVITACION_TRES" || modalidad === "INVITACION_RESTRINGIDA") {
    return {
      actosObligatorios: ["RECEPCION", "APERTURA", "EVALUACION", "DICTAMEN", "FALLO"],
      tieBreakPolicy: ["precio", "fechaRecepcion", "sorteo_documentado"],
    };
  }
  if (m === "DIALOGO_COMPETITIVO") {
    return {
      actosObligatorios: ["RECEPCION", "EVALUACION", "DICTAMEN", "FALLO"],
      tieBreakPolicy: ["precio", "sorteo_documentado"],
    };
  }
  if (m === "ACUERDO_MARCO_ASIGNACION" || m === "TIENDA_DIGITAL_ORDEN") {
    return {
      actosObligatorios: ["EVALUACION", "FALLO"],
      tieBreakPolicy: ["precio"],
    };
  }
  return {
    actosObligatorios: ["JUNTA_ACLARACIONES", "RECEPCION", "APERTURA", "EVALUACION", "DICTAMEN", "FALLO"],
    tieBreakPolicy: ["precio", "fechaRecepcion", "sorteo_documentado"],
  };
}

/**
 * Legacy hard-refuse for modalities 4–7 without auth metadata.
 * Prefer assertModalidadPublishable (governed gates). Kept for tests/compat.
 */
export function assertModalidadWorkflowSupported(modalidad: ModalidadProcedimiento, requisitos?: PolicyRequisitos) {
  const m = normalizeModalidad(modalidad);
  if (WORKFLOW_SUPPORTED_MODALIDADES.has(modalidad) || WORKFLOW_SUPPORTED_MODALIDADES.has(m)) return;
  if (requisitos?.workflowSupported === true) return;
  // If publishable metadata is present, allow (delegates to publishable checks).
  try {
    assertModalidadPublishable(modalidad, requisitos ?? {});
    return;
  } catch {
    /* fall through to legacy message when meta incomplete */
  }
  const constraint = HACIENDA_COMITE_CONSTRAINED.has(m)
    ? " Requiere autorización Hacienda/Comité (LAASSP)."
    : "";
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `La modalidad ${modalidad} está en catálogo LAASSP pero carece de metadatos de autorización / referencia requeridos.${constraint}`,
  });
}

/**
 * Governed publish gate for LAASSP modalities 4–7.
 * Refuses silent fall-through to LP without required metadata.
 */
export function assertModalidadPublishable(
  modalidad: ModalidadProcedimiento,
  requisitos: PolicyRequisitos = {},
) {
  const m = normalizeModalidad(modalidad);
  if (WORKFLOW_SUPPORTED_MODALIDADES.has(modalidad) || WORKFLOW_SUPPORTED_MODALIDADES.has(m)) {
    return;
  }

  if (m === "DIALOGO_COMPETITIVO" || m === "ADJUDICACION_DIRECTA_NEGOCIACION") {
    const comite = typeof requisitos.autorizacionComiteRef === "string"
      ? requisitos.autorizacionComiteRef.trim()
      : "";
    const hacienda = requisitos.autorizadoPorHacienda === true
      || requisitos.autorizadoPorHacienda === "true"
      || (typeof requisitos.autorizadoPorHacienda === "string" && requisitos.autorizadoPorHacienda.trim().length > 0);
    if (!comite) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Modalidad ${m}: falta autorizacionComiteRef (autorización de Comité). No se publica como LP.`,
      });
    }
    if (!hacienda) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Modalidad ${m}: falta autorizadoPorHacienda. No se publica como LP.`,
      });
    }
    return;
  }

  if (m === "ACUERDO_MARCO_ASIGNACION") {
    const ref = (requisitos.acuerdoMarcoId || requisitos.acuerdoMarcoRef || "").toString().trim();
    if (!ref) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Modalidad ACUERDO_MARCO_ASIGNACION: se requiere acuerdoMarcoId / acuerdoMarcoRef. No se publica convocatoria LP completa sin referencia.",
      });
    }
    return;
  }

  if (m === "TIENDA_DIGITAL_ORDEN") {
    const ref = (requisitos.tiendaCatalogoRef || requisitos.ordenCompraRef || "").toString().trim();
    if (!ref) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Modalidad TIENDA_DIGITAL_ORDEN: se requiere tiendaCatalogoRef u ordenCompraRef. Flujo simplificado — no presentación LP completa.",
      });
    }
    return;
  }

  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `Modalidad ${modalidad} no tiene flujo de publicación gobernado.`,
  });
}

/**
 * Refuse LP-only transitions that do not apply to modalities 4–7.
 * act examples: JUNTA_ACLARACIONES, RECEPCION_PUBLICA, APERTURA_PUBLICA, PRESENTACION_LP, FALLO, EVALUACION
 */
export function assertTransitionAllowed(
  modalidad: ModalidadProcedimiento,
  act: string,
  requisitos?: PolicyRequisitos,
) {
  const m = normalizeModalidad(modalidad);
  const req = requisitos ?? {};
  const actos = defaultPolicyForModalidad(m).actosObligatorios;

  if (m === "TIENDA_DIGITAL_ORDEN" || req.refuseFullLpPresentacion) {
    if (["JUNTA_ACLARACIONES", "RECEPCION_PUBLICA", "APERTURA_PUBLICA", "PRESENTACION_LP", "RECEPCION"].includes(act)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `TIENDA_DIGITAL_ORDEN: acto ${act} no aplica (flujo simplificado de orden/catálogo).`,
      });
    }
  }

  if (m === "ACUERDO_MARCO_ASIGNACION" || req.skipConvocatoriaPublica) {
    if (["JUNTA_ACLARACIONES", "PRESENTACION_LP"].includes(act)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `ACUERDO_MARCO_ASIGNACION: acto ${act} omitido — se asigna sobre acuerdo marco referenciado.`,
      });
    }
  }

  if (m === "DIALOGO_COMPETITIVO") {
    // Classic LP junta without Comité auth is refused; diálogo uses dialogo_rondas MVP.
    if (act === "JUNTA_ACLARACIONES" && !(req.autorizacionComiteRef || "").toString().trim()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "DIALOGO_COMPETITIVO: junta LP clásica requiere autorizacionComiteRef; use rondas de diálogo (dialogo_rondas).",
      });
    }
  }

  // Diálogo / negociación acts — refuse on LP-only modalities
  const dialogoActs = ["DIALOGO_RONDA_ABRIR", "DIALOGO_RONDA_CERRAR", "DIALOGO_NOTA"];
  if (dialogoActs.includes(act)) {
    if (act === "DIALOGO_NOTA") {
      if (m !== "DIALOGO_COMPETITIVO" && m !== "ADJUDICACION_DIRECTA_NEGOCIACION") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Acto ${act} no aplica a modalidad ${m} (sólo DIALOGO_COMPETITIVO / ADJUDICACION_DIRECTA_NEGOCIACION).`,
        });
      }
    } else if (m !== "DIALOGO_COMPETITIVO") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Acto ${act} sólo aplica a DIALOGO_COMPETITIVO (modalidad actual: ${m}).`,
      });
    }
    if (m === "DIALOGO_COMPETITIVO" && !(req.autorizacionComiteRef || "").toString().trim()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "DIALOGO_COMPETITIVO: actos de ronda requieren autorizacionComiteRef en modalidadMeta.",
      });
    }
  }

  if (m === "ADJUDICACION_DIRECTA_NEGOCIACION" && act === "FALLO") {
    const notas = (req.notasNegociacion || "").toString().trim();
    if (!notas) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "ADJUDICACION_DIRECTA_NEGOCIACION: notasNegociacion son obligatorias antes del fallo.",
      });
    }
  }

  // If act maps to an acto obligatorio name and modality defaults omit it, refuse
  const actoMap: Record<string, string> = {
    JUNTA_ACLARACIONES: "JUNTA_ACLARACIONES",
    APERTURA_PUBLICA: "APERTURA",
    APERTURA: "APERTURA",
    RECEPCION: "RECEPCION",
    RECEPCION_PUBLICA: "RECEPCION",
  };
  const mapped = actoMap[act];
  if (mapped && !actos.includes(mapped) && !WORKFLOW_SUPPORTED_MODALIDADES.has(m)) {
    // Already handled special cases above; soft-check for remaining
    if (["ACUERDO_MARCO_ASIGNACION", "TIENDA_DIGITAL_ORDEN", "ADJUDICACION_DIRECTA", "ADJUDICACION_DIRECTA_NEGOCIACION"].includes(m)) {
      if (mapped === "APERTURA" || mapped === "JUNTA_ACLARACIONES") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Modalidad ${m}: acto ${act} no figura en actos obligatorios de política (${actos.join(", ")}).`,
        });
      }
    }
  }
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
  opts: {
    modalidad: ModalidadProcedimiento;
    tipoContratacion: string;
    marcoJuridico?: string | null;
    /** Procedure-level gate fields (Comité, acuerdo marco, tienda, etc.). */
    modalidadMeta?: unknown;
  },
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

  // Prefer exact modalidad; fall back INVITACION_TRES ↔ INVITACION_RESTRINGIDA.
  let policy = await db.query.procedurePolicies.findFirst({
    where: and(
      eq(procedurePolicies.regimeId, regime.id),
      eq(procedurePolicies.modalidad, opts.modalidad),
    ),
    orderBy: [desc(procedurePolicies.version)],
  });
  if (!policy && (opts.modalidad === "INVITACION_TRES" || opts.modalidad === "INVITACION_RESTRINGIDA")) {
    const alt = opts.modalidad === "INVITACION_TRES" ? "INVITACION_RESTRINGIDA" : "INVITACION_TRES";
    policy = await db.query.procedurePolicies.findFirst({
      where: and(
        eq(procedurePolicies.regimeId, regime.id),
        eq(procedurePolicies.modalidad, alt),
      ),
      orderBy: [desc(procedurePolicies.version)],
    });
  }
  if (!policy) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `No hay ProcedurePolicy para modalidad ${opts.modalidad} bajo régimen ${code}. La publicación requiere política.`,
    });
  }
  assertModalidadPublishable(opts.modalidad, mergeModalidadRequisitos(policy.requisitos, opts.modalidadMeta));
  return policy as ProcedurePolicySnapshot;
}

export function policyRequiresJunta(actosObligatorios: string[]): boolean {
  return actosObligatorios.includes("JUNTA_ACLARACIONES");
}
