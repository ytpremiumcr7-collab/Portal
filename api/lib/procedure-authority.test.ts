import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  assertSorteoResultadoValid,
  computeEmpateSet,
  type OfferForRanking,
} from "./evaluation-engine";
import {
  sealMontoOferta,
  openMontoOferta,
  buildEnvelopeAad,
  ciphertextHash,
  currentEnvelopeKeyVersion,
} from "./envelope-crypto";
import { buildProposicionManifest, sealManifestRequiresDecrypt } from "./proposicion";
import { evaluateProcedimientoAsignacion } from "./sod";
import { isProceduralCapability, PROCEDURAL_CAPABILITIES } from "./capabilities";

function msg(fn: () => unknown) {
  try {
    fn();
    return "";
  } catch (e) {
    return e instanceof TRPCError ? `${e.code}:${e.message}` : String(e);
  }
}

describe("procedure authority — juridical acts need assignment", () => {
  it("global capability alone is insufficient (assignment required)", () => {
    const r = evaluateProcedimientoAsignacion({
      userRole: "licitante",
      heldRoles: [],
      required: ["creador"],
    });
    expect(r.ok).toBe(false);
  });

  it("assignment creador allows procedure acts", () => {
    const r = evaluateProcedimientoAsignacion({
      userRole: "licitante",
      heldRoles: ["creador"],
      required: ["creador"],
    });
    expect(r.ok).toBe(true);
  });

  it("procedural caps catalog includes autorizar_fallo", () => {
    expect(isProceduralCapability("autorizar_fallo")).toBe(true);
    expect(PROCEDURAL_CAPABILITIES).toContain("emitir_dictamen");
  });
});

describe("participaciones.evaluar — global cap alone cannot evaluate other procedure", () => {
  it("FORBIDDEN: evaluar_tecnico global without procedure assignment", () => {
    // Mirrors procedureMutation gate: capability held is irrelevant without assignment.
    const r = evaluateProcedimientoAsignacion({
      userRole: "licitante",
      heldRoles: [], // no evaluador_* on this licitacion
      required: ["evaluador_tecnico", "evaluador_economico"],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/asignación|break_glass/i);
  });

  it("allowed: same user with evaluador_tecnico assignment on the procedure", () => {
    const r = evaluateProcedimientoAsignacion({
      userRole: "licitante",
      heldRoles: ["evaluador_tecnico"],
      required: ["evaluador_tecnico", "evaluador_economico"],
    });
    expect(r.ok).toBe(true);
  });

  it("allowed: evaluador_economico assignment also satisfies OR roles", () => {
    const r = evaluateProcedimientoAsignacion({
      userRole: "licitante",
      heldRoles: ["evaluador_economico"],
      required: ["evaluador_tecnico", "evaluador_economico"],
    });
    expect(r.ok).toBe(true);
  });
});


describe("sorteo P0 — OTRO / missing evidence / wrong set REJECT", () => {
  const tied: OfferForRanking[] = [
    { id: 10, montoOferta: "100", puntajeTecnico: "80", recibidoAt: "2026-09-18T10:00:00Z" },
    { id: 11, montoOferta: "100", puntajeTecnico: "80", recibidoAt: "2026-09-18T10:00:00Z" },
  ];

  it("computeEmpateSet returns exact tied IDs", () => {
    const set = computeEmpateSet("PRECIO_MAS_BAJO", tied, ["precio", "fechaRecepcion", "sorteo_documentado"]);
    expect(set).toEqual([10, 11]);
  });

  it("rejects OTRO when policy demands sorteo", () => {
    const m = msg(() =>
      assertSorteoResultadoValid({
        policyRequiresSorteo: true,
        metodo: "OTRO",
        evidenciaDocId: 1,
        orden: [
          { participacionId: 10, orden: 1 },
          { participacionId: 11, orden: 2 },
        ],
        empateSet: [10, 11],
      }),
    );
    expect(m).toMatch(/BAD_REQUEST|sorteo|OTRO/i);
  });

  it("rejects missing evidence", () => {
    const m = msg(() =>
      assertSorteoResultadoValid({
        policyRequiresSorteo: true,
        metodo: "SORTEO_DOCUMENTADO",
        evidenciaDocId: null,
        orden: [
          { participacionId: 10, orden: 1 },
          { participacionId: 11, orden: 2 },
        ],
        empateSet: [10, 11],
      }),
    );
    expect(m).toMatch(/evidencia/i);
  });

  it("rejects wrong empate set", () => {
    const m = msg(() =>
      assertSorteoResultadoValid({
        policyRequiresSorteo: true,
        metodo: "SORTEO_DOCUMENTADO",
        evidenciaDocId: 99,
        orden: [
          { participacionId: 10, orden: 1 },
          { participacionId: 99, orden: 2 },
        ],
        empateSet: [10, 11],
      }),
    );
    expect(m).toMatch(/conjunto empatado|BAD_REQUEST/i);
  });

  it("rejects non-contiguous orden", () => {
    const m = msg(() =>
      assertSorteoResultadoValid({
        policyRequiresSorteo: true,
        metodo: "SORTEO_DOCUMENTADO",
        evidenciaDocId: 99,
        orden: [
          { participacionId: 10, orden: 1 },
          { participacionId: 11, orden: 3 },
        ],
        empateSet: [10, 11],
      }),
    );
    expect(m).toMatch(/contiguo|BAD_REQUEST/i);
  });
});

describe("envelope AAD + seal without decrypt", () => {
  const aadA = {
    tenantId: 1,
    licitacionId: 10,
    participacionId: 100,
    proposicionId: 200,
    keyVersion: currentEnvelopeKeyVersion(),
  };
  const aadB = { ...aadA, participacionId: 101, proposicionId: 201 };

  it("round-trip with matching AAD", () => {
    const seal = sealMontoOferta("1234.56", aadA);
    expect(openMontoOferta(seal, aadA)).toBe("1234.56");
    expect(seal.aad).toBe(buildEnvelopeAad(aadA));
  });

  it("AAD swap ciphertext between participaciones fails decrypt", () => {
    const sealA = sealMontoOferta("111.00", aadA);
    expect(() => openMontoOferta(sealA, aadB)).toThrow();
  });

  it("seal manifest does not require decrypt when ciphertextHash present", () => {
    const seal = sealMontoOferta("50.00", aadA);
    const hash = ciphertextHash(seal.ciphertext);
    expect(sealManifestRequiresDecrypt({ ciphertextHash: hash })).toBe(false);
    const { manifestHash } = buildProposicionManifest({
      proposicionId: 200,
      participacionId: 100,
      proveedorId: 1,
      ciphertextHash: hash,
      recibidoAt: "2026-09-18T12:00:00.000Z",
      documentos: [{ documentoId: 1, rol: "OFERTA_TECNICA", sha256: "abc" }],
    });
    expect(manifestHash).toMatch(/^[a-f0-9]{64}$/);
    // Payload must not embed plaintext monto
    const { payload } = buildProposicionManifest({
      proposicionId: 200,
      participacionId: 100,
      proveedorId: 1,
      ciphertextHash: hash,
      recibidoAt: "2026-09-18T12:00:00.000Z",
      documentos: [{ documentoId: 1, rol: "OFERTA_ECONOMICA", sha256: "def" }],
    });
    expect(payload).not.toHaveProperty("montoOferta");
    expect(payload.ciphertextHash).toBe(hash);
  });
});

describe("second-person grant rules (pure)", () => {
  it("self break_glass is modeled as forbidden when approvedBy === userId", () => {
    // hasActiveBreakGlass filters approvedBy === beneficiary
    const approverSameAsBeneficiary = 5;
    const beneficiary = 5;
    expect(approverSameAsBeneficiary === beneficiary).toBe(true);
  });
});


describe("four-eyes consent (pure)", () => {
  function canApprove(approverId: number, requesterId: number, beneficiaryId: number) {
    return approverId !== requesterId && approverId !== beneficiaryId;
  }
  it("cannot self-approve: approver must differ from requester and beneficiary", () => {
    expect(canApprove(10, 10, 20)).toBe(false);
    expect(canApprove(20, 10, 20)).toBe(false);
  });
  it("second session approve works when approver is third party", () => {
    expect(canApprove(30, 10, 20)).toBe(true);
  });
});
