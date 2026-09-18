import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  rankAdmisibles, assertIsPrimerLugar, computeScoresAndOrden, hashReglas,
  type FrozenReglas,
} from "./evaluation-engine";

function msg(fn: () => unknown) {
  try { fn(); return ""; } catch (e) { return e instanceof TRPCError ? e.message : String(e); }
}

const baseReglas = (criterio: FrozenReglas["criterioEvaluacion"]): FrozenReglas => ({
  criterioEvaluacion: criterio,
  ponderacionTecnica: "40.00",
  ponderacionEconomica: "60.00",
  modoEvaluacion: "HIBRIDA",
  tipoLicitacion: "LICITACION_PUBLICA",
  tipoContratacion: "SERVICIO",
  marcoJuridico: "LAASSP",
  rubricaTecnica: null,
});

describe("evaluation criterion branching", () => {
  const offers = [
    { id: 1, montoOferta: "1000", puntajeTecnico: "90", puntajeEconomico: "80", puntajeTotal: "84" },
    { id: 2, montoOferta: "800", puntajeTecnico: "70", puntajeEconomico: "100", puntajeTotal: "88" },
    { id: 3, montoOferta: "900", puntajeTecnico: "95", puntajeEconomico: "88.89", puntajeTotal: "91.33" },
  ];

  it("PRECIO_MAS_BAJO ranks by min price (not max puntajeTotal)", () => {
    const ranked = rankAdmisibles("PRECIO_MAS_BAJO", offers);
    expect(ranked[0]).toBe(2); // 800
    expect(msg(() => assertIsPrimerLugar("PRECIO_MAS_BAJO", offers, 3))).toContain("primer lugar");
    expect(() => assertIsPrimerLugar("PRECIO_MAS_BAJO", offers, 2)).not.toThrow();
  });

  it("MEJOR_RELACION_CALIDAD_PRECIO ranks by puntajeTotal", () => {
    const ranked = rankAdmisibles("MEJOR_RELACION_CALIDAD_PRECIO", offers);
    expect(ranked[0]).toBe(3);
  });

  it("MEJOR_VALOR_TECNICO ranks by technical score", () => {
    const ranked = rankAdmisibles("MEJOR_VALOR_TECNICO", offers);
    expect(ranked[0]).toBe(3); // tech 95
  });

  it("computeScoresAndOrden uses frozen criterion for ordenMerito", () => {
    const admisibles = [
      { id: 1, montoOferta: "1000", puntajeTecnico: "90" },
      { id: 2, montoOferta: "800", puntajeTecnico: "70" },
    ];
    const precio = computeScoresAndOrden(baseReglas("PRECIO_MAS_BAJO"), admisibles);
    expect(precio.find((p) => p.id === 2)!.ordenMerito).toBe(1);
    const valor = computeScoresAndOrden(baseReglas("MEJOR_VALOR_TECNICO"), admisibles);
    expect(valor.find((p) => p.id === 1)!.ordenMerito).toBe(1);
    const rel = computeScoresAndOrden(baseReglas("MEJOR_RELACION_CALIDAD_PRECIO"), admisibles);
    // id2 has econ 100 and tech 70 → 70*0.4+100*0.6=88; id1 tech90 econ80 → 84
    expect(rel.find((p) => p.id === 2)!.ordenMerito).toBe(1);
  });

  it("hashReglas is stable", () => {
    const a = hashReglas(baseReglas("PRECIO_MAS_BAJO"));
    const b = hashReglas(baseReglas("PRECIO_MAS_BAJO"));
    expect(a).toBe(b);
    expect(a).not.toBe(hashReglas(baseReglas("MEJOR_VALOR_TECNICO")));
  });
});
