import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  rankAdmisibles,
  assertIsPrimerLugar,
  hashReglas,
  type FrozenReglas,
  type TieBreakKey,
} from "./evaluation-engine";
import {
  parseTieBreakPolicy,
  assertActosPermitidosPorPolitica,
  defaultPolicyForModalidad,
} from "./procedure-policy";
import {
  buildProposicionManifest,
  buildAperturaSealFromProposicionManifests,
  assertProposicionDocsCompletos,
} from "./proposicion";
import { efectoLegalFromEventType } from "./outbox";
import { assertFiniquitoGates } from "./finiquito-gates";

function msg(fn: () => unknown) {
  try {
    fn();
    return "";
  } catch (e) {
    return e instanceof TRPCError ? e.message : String(e);
  }
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

describe("A — ProcedurePolicy / tie-break", () => {
  it("policy freeze hash is stable", () => {
    expect(hashReglas(baseReglas("PRECIO_MAS_BAJO"))).toBe(hashReglas(baseReglas("PRECIO_MAS_BAJO")));
  });

  it("tie-break uses fechaRecepcion when prices equal — not silent id ASC as primary", () => {
    const offers = [
      { id: 1, montoOferta: "100", puntajeTecnico: "80", recibidoAt: "2026-09-18T12:00:00Z" },
      { id: 2, montoOferta: "100", puntajeTecnico: "80", recibidoAt: "2026-09-18T10:00:00Z" },
    ];
    const tb: TieBreakKey[] = ["precio", "fechaRecepcion", "sorteo_documentado"];
    const ranked = rankAdmisibles("PRECIO_MAS_BAJO", offers, tb);
    expect(ranked[0]).toBe(2);
  });

  it("ADJUDICACION_DIRECTA forbids junta when policy omits it", () => {
    const def = defaultPolicyForModalidad("ADJUDICACION_DIRECTA");
    expect(
      msg(() =>
        assertActosPermitidosPorPolitica("ADJUDICACION_DIRECTA", def.actosObligatorios, [
          "JUNTA_ACLARACIONES",
          "FALLO",
        ]),
      ),
    ).toContain("JUNTA_ACLARACIONES");
  });

  it("parseTieBreakPolicy provides documented defaults", () => {
    expect(parseTieBreakPolicy([])[0]).toBe("precio");
  });
});

describe("B — Proposición manifest seal", () => {
  it("manifest uses proposicion docs only", () => {
    const docs = [
      { documentoId: 10, rol: "OFERTA_TECNICA" as const, sha256: "aaa" },
      { documentoId: 11, rol: "OFERTA_ECONOMICA" as const, sha256: "bbb" },
    ];
    assertProposicionDocsCompletos(docs);
    const { manifestHash } = buildProposicionManifest({
      proposicionId: 1,
      participacionId: 5,
      proveedorId: 9,
      montoOferta: "1000.00",
      recibidoAt: "2026-09-18T10:00:00Z",
      documentos: docs,
    });
    expect(manifestHash).toMatch(/^[a-f0-9]{64}$/);
    const seal = buildAperturaSealFromProposicionManifests([
      { proposicionId: 1, proveedorId: 9, manifestHash },
      { proposicionId: 2, proveedorId: 8, manifestHash: "c".repeat(64) },
    ]);
    const seal2 = buildAperturaSealFromProposicionManifests([
      { proposicionId: 2, proveedorId: 8, manifestHash: "c".repeat(64) },
      { proposicionId: 1, proveedorId: 9, manifestHash },
    ]);
    expect(seal).toBe(seal2);
  });
});

describe("C — Outbox legal effect derivation", () => {
  it("efectoLegal derived from eventType", () => {
    expect(efectoLegalFromEventType("FALLO_PUBLICADO")).toBe(true);
    expect(efectoLegalFromEventType("ADJUDICACION")).toBe(true);
    expect(efectoLegalFromEventType("RANDOM_CLIENT_FLAG")).toBe(false);
  });
});

describe("Finiquito bypass still blocked", () => {
  it("blocks inconsistent montoFinal", () => {
    expect(
      msg(() =>
        assertFiniquitoGates({
          criticalIncidenciasOpen: 0,
          pendingEstimaciones: 0,
          pendingEntregables: 0,
          paidCumulativeBruto: 100,
          contratoMonto: 100,
          montoFinal: 99,
          blockingGarantias: 0,
        }),
      ),
    ).toMatch(/montoFinal|concil/i);
  });
});
