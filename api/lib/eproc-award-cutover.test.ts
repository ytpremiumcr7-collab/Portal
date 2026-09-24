import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("lot decision, award and contract cutover", () => {
  it("persists one governed decision per fallo and lot", () => {
    const schema = read("db/schema-eproc.ts");
    expect(schema).toContain('mysqlTable("fallo_lot_decisions"');
    expect(schema).toContain('uniqueIndex("fallo_lot_decision_uq").on(t.tenantId, t.falloId, t.lotId)');
    expect(schema).toContain("falloDecisionId");
    expect(schema).toContain('currency: mysqlEnum("currency", ["MXN"])');
  });

  it("contracts are unique by award instead of by procedure", () => {
    const schema = read("db/schema.ts");
    expect(schema).toContain('uniqueIndex("contratos_tenant_award_uq").on(t.tenantId, t.awardId)');
    expect(schema).not.toContain('uniqueIndex("contratos_tenant_lic_uq")');
  });

  it("the post-expand migration backfills decisions before changing contract uniqueness", () => {
    const migration = read("db/migrations/0025_lot_award_contract_cutover.sql");
    const createDecisions = migration.indexOf("CREATE TABLE IF NOT EXISTS `fallo_lot_decisions`");
    const backfill = migration.indexOf("INSERT IGNORE INTO `fallo_lot_decisions`");
    const dropLegacyUnique = migration.indexOf("DROP INDEX `contratos_tenant_lic_uq`");
    const addAwardUnique = migration.indexOf("ADD UNIQUE KEY `contratos_tenant_award_uq`");

    expect(createDecisions).toBeGreaterThanOrEqual(0);
    expect(backfill).toBeGreaterThan(createDecisions);
    expect(dropLegacyUnique).toBeGreaterThan(backfill);
    expect(addAwardUnique).toBeGreaterThan(dropLegacyUnique);
  });

  it("new contract creation is award-scoped and the legacy adjudication writer is retired", () => {
    const contracts = read("api/routers/contratos.ts");
    const procedures = read("api/routers/licitaciones.ts");
    expect(contracts).toMatch(/crear:[\s\S]*awardId:\s*z\.number/);
    expect(contracts).toContain("eq(awards.status, \"PUBLISHED\")");
    expect(procedures).not.toMatch(/\n\s*adjudicar:\s*procedureMutation/);
  });
});
