import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  rankAdmisibles,
  compareTieBreak,
  parseDesempateOrden,
  type OfferForRanking,
} from "./evaluation-engine";
import { evaluateProcedimientoAsignacion } from "./sod";
import {
  canViewMontoOferta,
  isSobreEconomicoRevelado,
  isLegacyPlaintextCandidate,
  isRealMontoOferta,
  hasEnvelopeKeyConfigured,
} from "./sobre-economico";
import { isWithinRecepcionMs, isCanonicalRecepcionSource } from "./calendario-gates";
import { ROLE_CAPABILITIES } from "./capabilities";
import { CAPABILITIES } from "@db/schema";
import { SYSTEM_ACTOR_EMAIL, SYSTEM_ACTOR_SENTINEL, efectoLegalFromEventType } from "./outbox";
import { systemActorEmail } from "./system-actor";
import { sealMontoOferta, openMontoOferta, ciphertextDiffersFromPlaintext, ENVELOPE_PLACEHOLDER_MONTO } from "./envelope-crypto";

function msg(fn: () => unknown) {
  try {
    fn();
    return "";
  } catch (e) {
    return e instanceof TRPCError ? `${e.code}:${e.message}` : String(e);
  }
}

describe("P0-1 sorteo_documentado — no silent id fallback", () => {
  const tied: OfferForRanking[] = [
    { id: 1, montoOferta: "100", puntajeTecnico: "80", recibidoAt: "2026-09-18T10:00:00Z" },
    { id: 2, montoOferta: "100", puntajeTecnico: "80", recibidoAt: "2026-09-18T10:00:00Z" },
  ];

  it("throws PRECONDITION_FAILED when sorteo required and no desempate result", () => {
    const m = msg(() =>
      rankAdmisibles("PRECIO_MAS_BAJO", tied, ["precio", "fechaRecepcion", "sorteo_documentado"]),
    );
    expect(m).toContain("PRECONDITION_FAILED");
    expect(m.toLowerCase()).toMatch(/sorteo|desempate/);
  });

  it("never resolves residual tie by a.id - b.id when sorteo in policy", () => {
    const m = msg(() => compareTieBreak(tied[0], tied[1], ["sorteo_documentado"]));
    expect(m).toContain("PRECONDITION_FAILED");
  });

  it("consumes acto_desempate orden when present", () => {
    const withOrden: OfferForRanking[] = [
      { ...tied[0], desempateOrden: 2 },
      { ...tied[1], desempateOrden: 1 },
    ];
    const ranked = rankAdmisibles("PRECIO_MAS_BAJO", withOrden, [
      "precio",
      "fechaRecepcion",
      "sorteo_documentado",
    ]);
    expect(ranked[0]).toBe(2);
  });

  it("parseDesempateOrden maps participacionId → orden", () => {
    const map = parseDesempateOrden([
      { participacionId: 10, orden: 1 },
      { participacionId: 11, orden: 2 },
    ]);
    expect(map.get(10)).toBe(1);
    expect(map.get(11)).toBe(2);
  });
});

describe("P0-2 sealed economic envelope", () => {
  it("admin/licitante/evaluador cannot see price pre-apertura", () => {
    expect(canViewMontoOferta({ role: "admin", isOwner: false, aperturaEstado: "SELLADA" })).toBe(false);
    expect(canViewMontoOferta({ role: "licitante", isOwner: false, aperturaEstado: "RECEPCION_CERRADA" })).toBe(false);
    expect(canViewMontoOferta({ role: "licitante", isOwner: false, aperturaEstado: null })).toBe(false);
  });

  it("after apertura ABIERTA/PUBLICADA price is visible", () => {
    expect(isSobreEconomicoRevelado("ABIERTA")).toBe(true);
    expect(isSobreEconomicoRevelado("PUBLICADA")).toBe(true);
    expect(canViewMontoOferta({ role: "admin", isOwner: false, aperturaEstado: "ABIERTA" })).toBe(true);
    expect(canViewMontoOferta({ role: "licitante", isOwner: false, aperturaEstado: "PUBLICADA" })).toBe(true);
  });

  it("owner proveedor can see own sealed amount", () => {
    expect(canViewMontoOferta({ role: "proveedor", isOwner: true, aperturaEstado: "SELLADA" })).toBe(true);
  });
});

describe("P0-3 SoD admin bypass removed + break_glass", () => {
  it("admin does not auto-bypass assignment", () => {
    const r = evaluateProcedimientoAsignacion({
      userRole: "admin",
      heldRoles: [],
      required: ["evaluador_tecnico"],
    });
    expect(r.ok).toBe(false);
  });

  it("adminBypass=true is rejected (removed)", () => {
    const r = evaluateProcedimientoAsignacion({
      userRole: "admin",
      heldRoles: [],
      required: ["autorizador_fallo"],
      adminBypass: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/break_glass|eliminado/i);
  });

  it("break_glass allows bypass when granted", () => {
    const r = evaluateProcedimientoAsignacion({
      userRole: "admin",
      heldRoles: [],
      required: ["aprobar_pago"],
      hasBreakGlass: true,
    });
    expect(r.ok).toBe(true);
  });

  it("admin ROLE_CAPABILITIES is not auto-all CAPABILITIES", () => {
    expect(ROLE_CAPABILITIES.admin.length).toBeLessThan(CAPABILITIES.length);
    expect(ROLE_CAPABILITIES.admin).not.toContain("autorizar_fallo");
    expect(ROLE_CAPABILITIES.admin).not.toContain("aprobar_pago");
    expect(ROLE_CAPABILITIES.admin).not.toContain("evaluar_tecnico");
    expect(ROLE_CAPABILITIES.admin).toContain("break_glass");
  });
});

describe("P0-4 canonical reception deadline ms", () => {
  it("deadline+1ms REJECT", () => {
    const fin = Date.parse("2026-09-18T18:00:00.000Z");
    expect(isWithinRecepcionMs(fin, fin)).toBe(true);
    expect(isWithinRecepcionMs(fin + 1, fin)).toBe(false);
  });
});

describe("P1 outbox system actor sentinel", () => {
  it("does not invent actorUserId=1 constant", () => {
    expect(SYSTEM_ACTOR_SENTINEL).toBe("SYSTEM");
    expect(SYSTEM_ACTOR_EMAIL).toContain("piedra-angular");
    expect(systemActorEmail(3)).toBe("system+t3@piedra-angular.local");
  });

  it("efecto legal still recognized", () => {
    expect(efectoLegalFromEventType("CONTRATO_RESCINDIDO")).toBe(true);
  });
});

describe("P0-2b envelope encryption residual", () => {
  it("ciphertext differs from plaintext and round-trips", () => {
    process.env.ARES_ENVELOPE_KEY ??= Buffer.from("piedra-angular-dev-envelope-key!!").toString("base64");
    const seal = sealMontoOferta("42.00");
    expect(ciphertextDiffersFromPlaintext(seal.ciphertext, "42.00")).toBe(true);
    expect(openMontoOferta(seal)).toBe("42.00");
  });
});

describe("T-1 no day-only fechaCierre reception path", () => {
  it("canonical source is only calendario", () => {
    expect(isCanonicalRecepcionSource("calendario")).toBe(true);
    expect(isCanonicalRecepcionSource("fechaCierre_eod")).toBe(false);
  });

  it("gate module source forbids fechaCierre_eod / day-slice fallback", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./calendario-gates.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/fechaCierre_eod/);
    expect(src).not.toMatch(/T23:59:59\.999Z/);
    expect(src).toMatch(/assertRecepcionDentroDeVentana/);
    // opts must not accept fechaCierre
    expect(src).not.toMatch(/fechaCierre\?:/);
  });

  it("iniciarEvaluacion must not compare fechaCierre day strings", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../routers/licitaciones.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/fecha de cierre aún no ha llegado/);
    expect(src).not.toMatch(/toYmd\(current\.fechaCierre\)/);
  });
});

describe("T-2 legacy plaintext migrate helper", () => {
  it("detects real monto without sobre as legacy candidate", () => {
    expect(isRealMontoOferta("1500.00")).toBe(true);
    expect(isRealMontoOferta(ENVELOPE_PLACEHOLDER_MONTO)).toBe(false);
    expect(isLegacyPlaintextCandidate({ montoOferta: "1500.00", hasSobreEconomico: false })).toBe(true);
    expect(isLegacyPlaintextCandidate({ montoOferta: "1500.00", hasSobreEconomico: true })).toBe(false);
    expect(isLegacyPlaintextCandidate({ montoOferta: ENVELOPE_PLACEHOLDER_MONTO, hasSobreEconomico: false })).toBe(false);
  });

  it("blocks convocante view of legacy plaintext", () => {
    expect(
      canViewMontoOferta({
        role: "licitante",
        isOwner: false,
        aperturaEstado: null,
        legacyPlaintext: true,
      }),
    ).toBe(false);
    expect(
      canViewMontoOferta({
        role: "proveedor",
        isOwner: true,
        aperturaEstado: null,
        legacyPlaintext: true,
      }),
    ).toBe(true);
  });

  it("hasEnvelopeKeyConfigured reflects env", () => {
    const prev = process.env.ARES_ENVELOPE_KEY;
    delete process.env.ARES_ENVELOPE_KEY;
    expect(hasEnvelopeKeyConfigured()).toBe(false);
    process.env.ARES_ENVELOPE_KEY = Buffer.from("piedra-angular-dev-envelope-key!!").toString("base64");
    expect(hasEnvelopeKeyConfigured()).toBe(true);
    if (prev === undefined) delete process.env.ARES_ENVELOPE_KEY;
    else process.env.ARES_ENVELOPE_KEY = prev;
  });
});
