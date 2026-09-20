import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import {
  money, moneyFixed2, moneyCmp, moneyDiv, moneyMul, moneyMin, moneyClamp, moneyGt,
  type MoneyInput,
} from "./money";

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
  /** Position from completed acto_desempate (1 = first). Required when policy uses sorteo_documentado. */
  desempateOrden?: number | null;
};

/**
 * Canonical payload hashed at publish time. Evaluation/adjudicación MUST use frozen fields,
 * not live mutable licitacion columns.
 */
export function buildReglasPayload(input: FrozenReglas): Record<string, unknown> {
  return {
    criterioEvaluacion: input.criterioEvaluacion,
    ponderacionTecnica: moneyFixed2(input.ponderacionTecnica),
    ponderacionEconomica: moneyFixed2(input.ponderacionEconomica),
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
export function scoreEconomico(montoOferta: MoneyInput, minAdmissible: MoneyInput): number {
  const monto = money(montoOferta);
  const min = money(minAdmissible);
  if (!(min.gt(0)) || !(monto.gt(0))) return 0;
  const raw = moneyDiv(min, monto).mul(100);
  return Number(moneyFixed2(moneyClamp(raw, 0, 100)));
}

/**
 * Weighted quality-price total.
 */
export function scoreTotalRelacion(
  puntajeTecnico: number | string,
  puntajeEconomico: number | string,
  ponderacionTecnica: number | string,
  ponderacionEconomica: number | string,
): number {
  const tech = moneyMul(puntajeTecnico, moneyDiv(ponderacionTecnica, 100));
  const econ = moneyMul(puntajeEconomico, moneyDiv(ponderacionEconomica, 100));
  return Number(moneyFixed2(tech.plus(econ)));
}

export type TieBreakKey = "precio" | "fechaRecepcion" | "sorteo_documentado";

/**
 * Compare two offers after primary criterion already tied.
 * NEVER falls back to a.id - b.id when policy includes sorteo_documentado.
 * If sorteo_documentado is reached without completed desempateOrden → PRECONDITION_FAILED.
 */
export function compareTieBreak(
  a: OfferForRanking,
  b: OfferForRanking,
  keys: TieBreakKey[],
): number {
  const policyRequiresSorteo = keys.includes("sorteo_documentado");
  for (const key of keys) {
    if (key === "precio") {
      const dp = moneyCmp(a.montoOferta, b.montoOferta);
      if (dp !== 0) return dp;
    } else if (key === "fechaRecepcion") {
      const ta = a.recibidoAt ? new Date(a.recibidoAt).getTime() : Number.POSITIVE_INFINITY;
      const tb = b.recibidoAt ? new Date(b.recibidoAt).getTime() : Number.POSITIVE_INFINITY;
      if (ta !== tb) return ta - tb; // earlier reception wins
    } else if (key === "sorteo_documentado") {
      const oa = a.desempateOrden;
      const ob = b.desempateOrden;
      if (oa == null || ob == null || !Number.isFinite(Number(oa)) || !Number.isFinite(Number(ob))) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Empate residual: la política exige sorteo_documentado y no hay acto_desempate REGISTRADO con resultado para las ofertas empatadas.",
        });
      }
      const d = Number(oa) - Number(ob);
      if (d !== 0) return d;
    }
  }
  if (policyRequiresSorteo) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Empate residual tras sorteo_documentado: registre un acto_desempate con orden total. No se permite desempate silencioso por id.",
    });
  }
  // Only when policy does NOT require sorteo_documentado.
  return a.id - b.id;
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
export function rankAdmisibles(
  criterio: CriterioEvaluacion,
  offers: readonly OfferForRanking[],
  tieBreak: TieBreakKey[] = ["precio", "fechaRecepcion", "sorteo_documentado"],
): number[] {
  if (!offers.length) return [];
  const copy = [...offers];

  if (criterio === "PRECIO_MAS_BAJO") {
    copy.sort((a, b) => {
      const da = moneyCmp(a.montoOferta, b.montoOferta);
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
      try {
        if (!moneyGt(o.montoOferta, 0)) throw new Error("<=0");
      } catch {
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
  admisibles: Array<{
    id: number;
    montoOferta: string | number;
    puntajeTecnico: string | number | null;
    recibidoAt?: string | Date | null;
    desempateOrden?: number | null;
  }>,
  tieBreak: TieBreakKey[] = ["precio", "fechaRecepcion", "sorteo_documentado"],
): Array<{ id: number; puntajeEconomico: string; puntajeTotal: string; ordenMerito: number }> {
  const criterio = reglas.criterioEvaluacion;
  const minBid = admisibles.length
    ? moneyMin(...admisibles.map((x) => x.montoOferta))
    : money(0);
  const pt = money(reglas.ponderacionTecnica);
  const pe = money(reglas.ponderacionEconomica);

  const scored: OfferForRanking[] = admisibles.map((o) => {
    if (o.puntajeTecnico == null || o.puntajeTecnico === "") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Existe una oferta admisible sin evaluación técnica completa.",
      });
    }
    let technical: number;
    try {
      technical = Number(moneyFixed2(o.puntajeTecnico));
    } catch {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Existe una oferta admisible sin evaluación técnica completa.",
      });
    }
    const economic = scoreEconomico(o.montoOferta, minBid);
    let total: number;
    if (criterio === "PRECIO_MAS_BAJO") {
      total = economic;
    } else if (criterio === "MEJOR_VALOR_TECNICO") {
      total = technical;
    } else {
      total = scoreTotalRelacion(technical, economic, pt.toString(), pe.toString());
    }
    return {
      id: o.id,
      montoOferta: o.montoOferta,
      puntajeTecnico: technical,
      puntajeEconomico: economic,
      puntajeTotal: total,
      recibidoAt: o.recibidoAt ?? null,
      desempateOrden: o.desempateOrden ?? null,
    };
  });

  const order = rankAdmisibles(criterio, scored, tieBreak);
  const orderIndex = new Map(order.map((id, i) => [id, i + 1]));
  return scored.map((o) => ({
    id: o.id,
    puntajeEconomico: moneyFixed2(o.puntajeEconomico ?? 0),
    puntajeTotal: moneyFixed2(o.puntajeTotal ?? 0),
    ordenMerito: orderIndex.get(o.id)!,
  }));
}

/** Parse acto_desempate.resultado_json → Map<participacionId, orden>. */
export function parseDesempateOrden(resultadoJson: unknown): Map<number, number> {
  const map = new Map<number, number>();
  if (!resultadoJson) return map;
  const raw = typeof resultadoJson === "string" ? JSON.parse(resultadoJson) : resultadoJson;
  const list = Array.isArray(raw) ? raw : (raw as any)?.orden ?? (raw as any)?.ranking ?? [];
  if (!Array.isArray(list)) return map;
  for (const row of list) {
    const pid = Number((row as any).participacionId ?? (row as any).id);
    const orden = Number((row as any).orden ?? (row as any).posicion);
    if (Number.isFinite(pid) && Number.isFinite(orden)) map.set(pid, orden);
  }
  return map;
}


/**
 * Compute the exact set of participación IDs that remain tied after primary criterion
 * and non-sorteo tie-break keys — i.e. the set that sorteo_documentado must order.
 */

/**
 * Compute the exact set of participación IDs that remain tied after primary criterion
 * and non-sorteo tie-break keys — i.e. the set that sorteo_documentado must order.
 */
export function computeEmpateSet(
  criterio: CriterioEvaluacion,
  offers: OfferForRanking[],
  tieBreak: TieBreakKey[],
): number[] {
  if (offers.length < 2) return offers.map((o) => o.id);
  const keysBeforeSorteo = tieBreak.filter((k) => k !== "sorteo_documentado");

  let best: OfferForRanking[] = [];
  if (criterio === "PRECIO_MAS_BAJO") {
    const min = moneyMin(...offers.map((o) => o.montoOferta));
    best = offers.filter((o) => moneyCmp(o.montoOferta, min) === 0);
  } else if (criterio === "MEJOR_VALOR_TECNICO") {
    const max = Math.max(...offers.map((o) => Number(o.puntajeTecnico ?? -Infinity)));
    best = offers.filter((o) => Number(o.puntajeTecnico ?? -Infinity) === max);
  } else {
    const max = Math.max(...offers.map((o) => Number(o.puntajeTotal ?? -Infinity)));
    best = offers.filter((o) => Number(o.puntajeTotal ?? -Infinity) === max);
  }
  if (best.length <= 1) return best.map((o) => o.id);

  const primaryKey = (o: OfferForRanking): string => {
    if (criterio === "PRECIO_MAS_BAJO") return moneyFixed2(o.montoOferta);
    if (criterio === "MEJOR_VALOR_TECNICO") return moneyFixed2(o.puntajeTecnico ?? 0);
    return moneyFixed2(o.puntajeTotal ?? 0);
  };
  const sig = (o: OfferForRanking) => {
    const parts: string[] = [primaryKey(o)];
    for (const key of keysBeforeSorteo) {
      if (key === "precio") parts.push(`p:${moneyFixed2(o.montoOferta)}`);
      if (key === "fechaRecepcion") {
        parts.push(`f:${o.recibidoAt ? new Date(o.recibidoAt).toISOString() : ""}`);
      }
    }
    return parts.join("|");
  };
  const counts = new Map<string, OfferForRanking[]>();
  for (const o of best) {
    const s = sig(o);
    if (!counts.has(s)) counts.set(s, []);
    counts.get(s)!.push(o);
  }
  const residual: number[] = [];
  for (const group of counts.values()) {
    if (group.length >= 2) residual.push(...group.map((o) => o.id));
  }
  return residual.sort((a, b) => a - b);
}

export function assertSorteoResultadoValid(input: {
  policyRequiresSorteo: boolean;
  metodo: string;
  evidenciaDocId?: number | null;
  orden: Array<{ participacionId: number; orden: number }>;
  empateSet: number[];
}) {
  if (input.policyRequiresSorteo) {
    if (input.metodo !== "SORTEO_DOCUMENTADO") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "La política congelada exige sorteo_documentado; método OTRO rechazado.",
      });
    }
    if (!input.evidenciaDocId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "sorteo_documentado requiere evidenciaDocId.",
      });
    }
  }
  const ids = input.orden.map((o) => o.participacionId).sort((a, b) => a - b);
  const expected = [...input.empateSet].sort((a, b) => a - b);
  if (ids.length !== expected.length || ids.some((id, i) => id !== expected[i])) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `El orden debe cubrir exactamente el conjunto empatado [${expected.join(",")}]; recibido [${ids.join(",")}].`,
    });
  }
  const ordenes = input.orden.map((o) => o.orden).sort((a, b) => a - b);
  for (let i = 0; i < ordenes.length; i++) {
    if (ordenes[i] !== i + 1) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "El orden debe ser contiguo 1..N sin huecos ni duplicados.",
      });
    }
  }
  if (new Set(ordenes).size !== ordenes.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "El orden de desempate no puede tener posiciones duplicadas.",
    });
  }
}
