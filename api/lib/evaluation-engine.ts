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
      const dp = Number(a.montoOferta) - Number(b.montoOferta);
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
      total = economic;
    } else if (criterio === "MEJOR_VALOR_TECNICO") {
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
      desempateOrden: o.desempateOrden ?? null,
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
    const min = Math.min(...offers.map((o) => Number(o.montoOferta)));
    best = offers.filter((o) => Number(o.montoOferta) === min);
  } else if (criterio === "MEJOR_VALOR_TECNICO") {
    const max = Math.max(...offers.map((o) => Number(o.puntajeTecnico ?? -Infinity)));
    best = offers.filter((o) => Number(o.puntajeTecnico ?? -Infinity) === max);
  } else {
    const max = Math.max(...offers.map((o) => Number(o.puntajeTotal ?? -Infinity)));
    best = offers.filter((o) => Number(o.puntajeTotal ?? -Infinity) === max);
  }
  if (best.length <= 1) return best.map((o) => o.id);

  const primaryKey = (o: OfferForRanking): string => {
    if (criterio === "PRECIO_MAS_BAJO") return Number(o.montoOferta).toFixed(2);
    if (criterio === "MEJOR_VALOR_TECNICO") return Number(o.puntajeTecnico ?? 0).toFixed(2);
    return Number(o.puntajeTotal ?? 0).toFixed(2);
  };
  const sig = (o: OfferForRanking) => {
    const parts: string[] = [primaryKey(o)];
    for (const key of keysBeforeSorteo) {
      if (key === "precio") parts.push(`p:${Number(o.montoOferta).toFixed(2)}`);
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
