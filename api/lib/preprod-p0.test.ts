import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  rankAdmisibles,
  compareTieBreak,
  parseDesempateOrden,
  type OfferForRanking,
} from "./evaluation-engine";
import { evaluateProcedimientoAsignacion } from "./sod";
import { canViewMontoOferta, isSobreEconomicoRevelado } from "./sobre-economico";
import { isWithinRecepcionMs } from "./calendario-gates";
import { ROLE_CAPABILITIES } from "./capabilities";
import { CAPABILITIES } from "@db/schema";
import { SYSTEM_ACTOR_EMAIL, SYSTEM_ACTOR_SENTINEL, efectoLegalFromEventType } from "./outbox";

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
  });

  it("efecto legal still recognized", () => {
    expect(efectoLegalFromEventType("CONTRATO_RESCINDIDO")).toBe(true);
  });
});
