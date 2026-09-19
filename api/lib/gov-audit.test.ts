import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  assertActosPermitidosPorPolitica,
  defaultPolicyForModalidad,
  regimeCodeFromContratacion,
  policyRequiresJunta,
  parseRequisitos,
} from "./procedure-policy";
import {
  assertProposicionSelladaCompleta,
  assertProposicionDocsCompletos,
  mapEvalToProposicionEstado,
  buildProposicionManifest,
} from "./proposicion";
import { efectoLegalFromEventType } from "./outbox";
import { assertFiniquitoGates } from "./finiquito-gates";
import { rankAdmisibles } from "./evaluation-engine";

function msg(fn: () => unknown) {
  try {
    fn();
    return "";
  } catch (e) {
    return e instanceof TRPCError ? e.message : String(e);
  }
}

describe("policy regime match helpers", () => {
  it("OBRA → LOPSRM else LAASSP", () => {
    expect(regimeCodeFromContratacion("OBRA")).toBe("LOPSRM");
    expect(regimeCodeFromContratacion("SERVICIO")).toBe("LAASSP");
  });

  it("IR does not require junta; LP does", () => {
    const ir = defaultPolicyForModalidad("INVITACION_RESTRINGIDA");
    const lp = defaultPolicyForModalidad("LICITACION_PUBLICA");
    expect(policyRequiresJunta(ir.actosObligatorios)).toBe(false);
    expect(policyRequiresJunta(lp.actosObligatorios)).toBe(true);
  });

  it("assertActos fails when junta missing for LP configured hitos", () => {
    const lp = defaultPolicyForModalidad("LICITACION_PUBLICA");
    expect(
      msg(() => assertActosPermitidosPorPolitica("LICITACION_PUBLICA", lp.actosObligatorios, [])),
    ).toContain("JUNTA_ACLARACIONES");
  });

  it("AD forbids junta when configured but not in policy", () => {
    const ad = defaultPolicyForModalidad("ADJUDICACION_DIRECTA");
    expect(
      msg(() =>
        assertActosPermitidosPorPolitica("ADJUDICACION_DIRECTA", ad.actosObligatorios, [
          "JUNTA_ACLARACIONES",
        ]),
      ),
    ).toContain("JUNTA_ACLARACIONES");
  });
});

describe("proposicion authority", () => {
  it("rejects live-bag completeness without sealed proposicion", () => {
    expect(msg(() => assertProposicionSelladaCompleta(null, []))).toMatch(/sellada|autoridad/i);
  });

  it("honors garantiaSeriedad requisito", () => {
    const docs = [
      { documentoId: 1, rol: "OFERTA_TECNICA" as const, sha256: "a" },
      { documentoId: 2, rol: "OFERTA_ECONOMICA" as const, sha256: "b" },
    ];
    expect(
      msg(() => assertProposicionDocsCompletos(docs, { garantiaSeriedad: true })),
    ).toMatch(/seriedad/i);
  });

  it("maps eval estados to proposicion", () => {
    expect(mapEvalToProposicionEstado("ADMISIBLE")).toBe("ADMISIBLE");
    expect(mapEvalToProposicionEstado("RECHAZADA")).toBe("DESECHADA");
    expect(mapEvalToProposicionEstado("GANADORA")).toBe("GANADORA");
  });

  it("manifest uses authoritative recibidoAt", () => {
    const { payload } = buildProposicionManifest({
      proposicionId: 1,
      participacionId: 2,
      proveedorId: 3,
      montoOferta: "10.00",
      recibidoAt: "2026-01-01T12:00:00.000Z",
      documentos: [
        { documentoId: 1, rol: "OFERTA_TECNICA", sha256: "aa" },
        { documentoId: 2, rol: "OFERTA_ECONOMICA", sha256: "bb" },
      ],
    });
    expect(payload.recibidoAt).toBe("2026-01-01T12:00:00.000Z");
  });
});

describe("outbox / rescision event codes", () => {
  it("CONTRATO_RESCINDIDO is legal effect (not FORMALIZADO)", () => {
    expect(efectoLegalFromEventType("CONTRATO_RESCINDIDO")).toBe(true);
    expect(efectoLegalFromEventType("CONTRATO_FORMALIZADO")).toBe(true);
  });
});

describe("finiquito still blocked", () => {
  it("blocks inconsistent montoFinal", () => {
    expect(
      msg(() =>
        assertFiniquitoGates({
          criticalIncidenciasOpen: 0,
          pendingEstimaciones: 0,
          pendingEntregables: 0,
          paidCumulativeBruto: 100,
          contratoMonto: 100,
          montoFinal: 50,
          blockingGarantias: 0,
        }),
      ),
    ).toMatch(/montoFinal|concil/i);
  });
});

describe("adjudicacion ranking uses recibidoAt", () => {
  it("earlier reception wins on equal price", () => {
    const ranked = rankAdmisibles(
      "PRECIO_MAS_BAJO",
      [
        { id: 10, montoOferta: "100", puntajeTecnico: "80", recibidoAt: "2026-09-18T15:00:00Z" },
        { id: 11, montoOferta: "100", puntajeTecnico: "80", recibidoAt: "2026-09-18T09:00:00Z" },
      ],
      ["precio", "fechaRecepcion", "sorteo_documentado"],
    );
    expect(ranked[0]).toBe(11);
  });
});

describe("requisitos parse", () => {
  it("reads garantiaSeriedad", () => {
    expect(parseRequisitos({ garantiaSeriedad: true }).garantiaSeriedad).toBe(true);
  });
});
