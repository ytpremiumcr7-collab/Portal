import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";

/** Published / frozen evaluation criterion modes. */
export type CriterioEvaluacion =
  | "PRECIO_MAS_BAJO"
  | "MEJOR_RELACION_CALIDAD_PRECIO"
  | "MEJOR_VALOR_TECNICO";

export type FrozenReglas = {
  criterioEvaluacion: CriterioEvaluacion;
  ponderacionTecnica: string | number;
  ponderacionEconomica: string | number;
  modoEvaluacion: string;
  tipoLicitacion: string;
  tipoContratacion: string;
  marcoJuridico: string;
  rubricaTecnica: string | null;
};

export type OfferForRanking = {
  id: number;
  montoOferta: string | number;
  puntajeTecnico: string | number | null;
  puntajeEconomico?: string | number | null;
  puntajeTotal?: string | number | null;
  /** Reception timestamp for fechaRecepcion tie-break (ISO or Date). */
  recibidoAt?: string | Date | null;
};

/**
 * Canonical payload hashed at publish time. Evaluation/adjudicación MUST use frozen fields,
 * not live mutable licitacion columns.
 */
export function buildReglasPayload(input: FrozenReglas): Record<string, unknown> {
  return {
    criterioEvaluacion: input.criterioEvaluacion,
    ponderacionTecnica: Number(input.ponderacionTecnica).toFixed(2),
    ponderacionEconomica: Number(input.ponderacionEconomica).toFixed(2),
    modoEvaluacion: input.modoEvaluacion,
    tipoLicitacion: input.tipoLicitacion,
    tipoContratacion: input.tipoContratacion,
    marcoJuridico: input.marcoJuridico,
    rubricaTecnica: input.rubricaTecnica ?? null,
  };
}

export function hashReglas(input: FrozenReglas): string {
  const payload = buildReglasPayload(input);
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Economic score (0–100): lowest admissible bid gets 100; others = min/bid * 100.
 * Used for MEJOR_RELACION_CALIDAD_PRECIO and as documentation check for MEJOR_VALOR_TECNICO.
 */
export function scoreEconomico(montoOferta: number, minAdmissible: number): number {
  if (!(minAdmissible > 0) || !(montoOferta > 0)) return 0;
  return Number(Math.max(0, Math.min(100, (minAdmissible / montoOferta) * 100)).toFixed(2));
}

/**
 * Weighted quality-price total.
 */
export function scoreTotalRelacion(
  puntajeTecnico: number,
  puntajeEconomico: number,
  ponderacionTecnica: number,
  ponderacionEconomica: number,
): number {
  return Number(
    (puntajeTecnico * (ponderacionTecnica / 100) + puntajeEconomico * (ponderacionEconomica / 100)).toFixed(2),
  );
}

/**
 * Rank ADMISIBLE offers according to frozen criterion.
 *
 * - PRECIO_MAS_BAJO: min montoOferta among ADMISIBLE (tech is pass/fail via ADMISIBLE).
 * - MEJOR_RELACION_CALIDAD_PRECIO: max puntajeTotal (weighted tech+econ).
 * - MEJOR_VALOR_TECNICO: max puntajeTecnico among solvent; econ score must be finite (documented check).
 *
 * Returns ordered ids (best first). Does NOT mutate.
 */

export type TieBreakKey = "precio" | "fechaRecepcion" | "sorteo_documentado";

function compareTieBreak(a: OfferForRanking, b: OfferForRanking, keys: TieBreakKey[]): number {
  for (const key of keys) {
    if (key === "precio") {
      const dp = Number(a.montoOferta) - Number(b.montoOferta);
      if (dp !== 0) return dp;
    } else if (key === "fechaRecepcion") {
      const ta = a.recibidoAt ? new Date(a.recibidoAt).getTime() : Number.POSITIVE_INFINITY;
      const tb = b.recibidoAt ? new Date(b.recibidoAt).getTime() : Number.POSITIVE_INFINITY;
      if (ta !== tb) return ta - tb; // earlier reception wins
    } else if (key === "sorteo_documentado") {
      // Documented lottery placeholder: stable ordering by id is NOT a silent primary rule;
      // it only applies after precio/fechaRecepcion are exhausted when policy lists sorteo.
      continue;
    }
  }
  // Last resort after documented policy keys — never the silent primary rule.
  return a.id - b.id;
}

export function rankAdmisibles(
  criterio: CriterioEvaluacion,
  offers: readonly OfferForRanking[],
  tieBreak: TieBreakKey[] = ["precio", "fechaRecepcion", "sorteo_documentado"],
): number[] {
  if (!offers.length) return [];
  const copy = [...offers];

  if (criterio === "PRECIO_MAS_BAJO") {
    copy.sort((a, b) => {
      const da = Number(a.montoOferta) - Number(b.montoOferta);
      if (da !== 0) return da;
      return compareTieBreak(a, b, tieBreak.filter((k) => k !== "precio"));
    });
    return copy.map((o) => o.id);
  }

  if (criterio === "MEJOR_VALOR_TECNICO") {
    for (const o of copy) {
      if (o.puntajeTecnico == null || !Number.isFinite(Number(o.puntajeTecnico))) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "MEJOR_VALOR_TECNICO exige puntaje técnico completo en ofertas admisibles.",
        });
      }
      // Documented economic check: offer amount must be a positive finite number (solvent bid present).
      if (!Number.isFinite(Number(o.montoOferta)) || Number(o.montoOferta) <= 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "MEJOR_VALOR_TECNICO exige oferta económica solvente (monto > 0) en admisibles.",
        });
      }
    }
    copy.sort((a, b) => {
      const dt = Number(b.puntajeTecnico) - Number(a.puntajeTecnico);
      if (dt !== 0) return dt;
      return compareTieBreak(a, b, tieBreak);
    });
    return copy.map((o) => o.id);
  }

  // MEJOR_RELACION_CALIDAD_PRECIO (default)
  for (const o of copy) {
    if (o.puntajeTotal == null || !Number.isFinite(Number(o.puntajeTotal))) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "MEJOR_RELACION_CALIDAD_PRECIO exige puntajeTotal completo en admisibles.",
      });
    }
  }
  copy.sort((a, b) => {
    const dt = Number(b.puntajeTotal) - Number(a.puntajeTotal);
    if (dt !== 0) return dt;
    return compareTieBreak(a, b, tieBreak);
  });
  return copy.map((o) => o.id);
}

/** True if `candidateId` is the sole first place under frozen criterio. */
export function assertIsPrimerLugar(
  criterio: CriterioEvaluacion,
  offers: readonly OfferForRanking[],
  candidateId: number,
  tieBreak: TieBreakKey[] = ["precio", "fechaRecepcion", "sorteo_documentado"],
) {
  const ranked = rankAdmisibles(criterio, offers, tieBreak);
  if (!ranked.length || ranked[0] !== candidateId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `El proveedor indicado no ocupa el primer lugar bajo criterio ${criterio}.`,
    });
  }
}

/**
 * Recompute economic + total scores and ordenMerito for ADMISIBLE set using frozen rules.
 * Returns patches to apply (id → fields).
 */
export function computeScoresAndOrden(
  reglas: FrozenReglas,
  admisibles: Array<{ id: number; montoOferta: string | number; puntajeTecnico: string | number | null; recibidoAt?: string | Date | null }>,
  tieBreak: TieBreakKey[] = ["precio", "fechaRecepcion", "sorteo_documentado"],
): Array<{ id: number; puntajeEconomico: string; puntajeTotal: string; ordenMerito: number }> {
  const criterio = reglas.criterioEvaluacion;
  const minBid = admisibles.length
    ? Math.min(...admisibles.map((x) => Number(x.montoOferta)))
    : 0;
  const pt = Number(reglas.ponderacionTecnica);
  const pe = Number(reglas.ponderacionEconomica);

  const scored: OfferForRanking[] = admisibles.map((o) => {
    const technical = Number(o.puntajeTecnico);
    if (!Number.isFinite(technical)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Existe una oferta admisible sin evaluación técnica completa.",
      });
    }
    const economic = scoreEconomico(Number(o.montoOferta), minBid);
    let total: number;
    if (criterio === "PRECIO_MAS_BAJO") {
      // Documented: winner is min price; total kept for display as inverse-price score.
      total = economic;
    } else if (criterio === "MEJOR_VALOR_TECNICO") {
      // Primarily technical; econ recorded for transparency.
      total = technical;
    } else {
      total = scoreTotalRelacion(technical, economic, pt, pe);
    }
    return {
      id: o.id,
      montoOferta: o.montoOferta,
      puntajeTecnico: technical,
      puntajeEconomico: economic,
      puntajeTotal: total,
      recibidoAt: o.recibidoAt ?? null,
    };
  });

  const order = rankAdmisibles(criterio, scored, tieBreak);
  const orderIndex = new Map(order.map((id, i) => [id, i + 1]));
  return scored.map((o) => ({
    id: o.id,
    puntajeEconomico: Number(o.puntajeEconomico).toFixed(2),
    puntajeTotal: Number(o.puntajeTotal).toFixed(2),
    ordenMerito: orderIndex.get(o.id)!,
  }));
}
