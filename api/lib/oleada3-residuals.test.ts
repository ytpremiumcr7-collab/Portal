import { describe, expect, it, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  SatEFirmaProvider,
  getSignatureProvider,
  assertCryptoKindWhenRequired,
  loadSatCasBundle,
  labelForSignatureKind,
  isOcspEnabled,
  isOcspFailOpen,
} from "./firma";
import { assertTransitionAllowed } from "./procedure-policy";

describe("Oleada 3 — FIEL honesty / providerStatus", () => {
  const prevOcsp = process.env.PA_EFIRMA_OCSP;
  afterEach(() => {
    if (prevOcsp === undefined) delete process.env.PA_EFIRMA_OCSP;
    else process.env.PA_EFIRMA_OCSP = prevOcsp;
  });

  it("CRYPTO required rejects SESSION; CRYPTO allowed", () => {
    expect(() => assertCryptoKindWhenRequired(true, "SESSION_CONFIRMATION")).toThrow(/CRYPTO_SIGNATURE/);
    expect(() => assertCryptoKindWhenRequired(true, "CRYPTO_SIGNATURE")).not.toThrow();
  });

  it("providerStatus-shaped payload reflects configured vs not", () => {
    process.env.PA_EFIRMA_OCSP = "0";
    const empty = loadSatCasBundle("/tmp/pa-sat-cas-empty-oleada3");
    const sat = new SatEFirmaProvider(empty);
    const status = {
      session: { name: "SessionConfirmationProvider", kind: "SESSION_CONFIRMATION", configured: true },
      crypto: {
        name: sat.name,
        kind: "CRYPTO_SIGNATURE" as const,
        configured: sat.isConfigured(),
        detail: empty.configured
          ? `issuers=${empty.issuers.length}`
          : `NOT_CONFIGURED: ${empty.missing.join("; ")}`,
        labels: {
          session: labelForSignatureKind("SESSION_CONFIRMATION"),
          crypto: labelForSignatureKind("CRYPTO_SIGNATURE"),
        },
      },
    };
    expect(status.session.configured).toBe(true);
    expect(status.crypto.configured).toBe(false);
    expect(status.crypto.detail).toMatch(/NOT_CONFIGURED/);
    expect(status.crypto.labels.session.toLowerCase()).toMatch(/no es e\.firma ni fiel/);
    expect(getSignatureProvider("CRYPTO_SIGNATURE").name).toBe("SatEFirmaProvider");
  });

  it("sat-cas README documents official drop path; no private keys committed", () => {
    const readme = readFileSync(join("api/lib/firma/sat-cas/README.md"), "utf8");
    expect(readme).toMatch(/AC4/);
    expect(readme).toMatch(/OCSP/);
    expect(readme).toMatch(/Never commit private keys|Do \*\*not\*\* commit private keys|never commit/i);
    expect(existsSync("docs/EFIRMA_E2E.md")).toBe(true);
    const e2e = readFileSync("docs/EFIRMA_E2E.md", "utf8");
    expect(e2e).toMatch(/External gate|external gate/i);
    expect(e2e).toMatch(/does \*\*not\*\* claim live FIEL E2E is done|not claim live FIEL/i);
  });

  it("OCSP helpers: fail-closed default; env toggles", () => {
    delete process.env.PA_EFIRMA_OCSP_FAIL_OPEN;
    expect(isOcspFailOpen()).toBe(false);
    process.env.PA_EFIRMA_OCSP = "0";
    expect(isOcspEnabled()).toBe(false);
    process.env.PA_EFIRMA_OCSP = "1";
    expect(isOcspEnabled()).toBe(true);
  });
});

describe("Oleada 3 — diálogo competitivo transitions", () => {
  const comite = { autorizacionComiteRef: "COMITE-DC-1", autorizadoPorHacienda: true };

  it("DIALOGO allows ronda acts with Comité meta; LP refuses", () => {
    expect(() => assertTransitionAllowed("DIALOGO_COMPETITIVO", "DIALOGO_RONDA_ABRIR", comite)).not.toThrow();
    expect(() => assertTransitionAllowed("DIALOGO_COMPETITIVO", "DIALOGO_RONDA_CERRAR", comite)).not.toThrow();
    expect(() => assertTransitionAllowed("DIALOGO_COMPETITIVO", "DIALOGO_NOTA", comite)).not.toThrow();
    expect(() => assertTransitionAllowed("LICITACION_PUBLICA", "DIALOGO_RONDA_ABRIR", {})).toThrow(
      /DIALOGO_COMPETITIVO/,
    );
    expect(() => assertTransitionAllowed("DIALOGO_COMPETITIVO", "DIALOGO_RONDA_ABRIR", {})).toThrow(
      /autorizacionComiteRef/,
    );
  });

  it("ADN may register negotiation notes; cannot open diálogo rounds", () => {
    expect(() =>
      assertTransitionAllowed("ADJUDICACION_DIRECTA_NEGOCIACION", "DIALOGO_NOTA", comite),
    ).not.toThrow();
    expect(() =>
      assertTransitionAllowed("ADJUDICACION_DIRECTA_NEGOCIACION", "DIALOGO_RONDA_ABRIR", comite),
    ).toThrow(/DIALOGO_COMPETITIVO/);
  });

  it("DIALOGO still refuses classic junta without Comité", () => {
    expect(() => assertTransitionAllowed("DIALOGO_COMPETITIVO", "JUNTA_ACLARACIONES", {})).toThrow(
      /autorizacionComiteRef|dialogo_rondas/,
    );
  });
});

describe("Oleada 3 — legal_entity_id invariant", () => {
  it("schema marks proveedores.legalEntityId NOT NULL", () => {
    const schema = readFileSync("db/schema.ts", "utf8");
    expect(schema).toMatch(
      /legalEntityId:\s*bigint\("legal_entity_id"[^)]*\)\.notNull\(\)/,
    );
    expect(existsSync("db/migrations/0021_dialogo_legal_entity.sql")).toBe(true);
    const mig = readFileSync("db/migrations/0021_dialogo_legal_entity.sql", "utf8");
    expect(mig).toMatch(/dialogo_rondas/);
    expect(mig).toMatch(/MODIFY COLUMN `legal_entity_id` bigint unsigned NOT NULL/);
  });
});
