import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { assertTaskCommandAllowed } from "./workflow";

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(resolve(here, "../../db/schema.ts"), "utf8");
const migration = readFileSync(resolve(here, "../../db/migrations/0024_eproc_institutional_expand.sql"), "utf8");

describe("multi-lot cutover invariants", () => {
  it("uniqueness is provider-per-lot, not provider-per-procedure", () => {
    expect(schema).toContain('uniqueIndex("participaciones_tenant_lot_proveedor_uq").on(t.tenantId, t.lotId, t.proveedorId)');
    expect(schema).toContain('uniqueIndex("prop_lot_prov_uq").on(t.tenantId, t.lotId, t.proveedorId)');
    expect(schema).not.toContain('uniqueIndex("participaciones_tenant_licitante_proveedor_uq")');
    expect(schema).not.toContain('uniqueIndex("prop_lic_prov_uq")');
  });

  it("migration contracts the legacy uniqueness only after lot backfill", () => {
    const backfill = migration.indexOf("SET p.lot_id=l.id WHERE p.lot_id IS NULL");
    const dropParticipation = migration.indexOf("participaciones_tenant_licitante_proveedor_uq");
    const addParticipation = migration.indexOf("participaciones_tenant_lot_proveedor_uq");
    const dropProposal = migration.indexOf("prop_lic_prov_uq");
    const addProposal = migration.indexOf("prop_lot_prov_uq");

    expect(backfill).toBeGreaterThan(0);
    expect(dropParticipation).toBeGreaterThan(backfill);
    expect(addParticipation).toBeGreaterThan(dropParticipation);
    expect(dropProposal).toBeGreaterThan(backfill);
    expect(addProposal).toBeGreaterThan(dropProposal);
  });
});

describe("workflow completion mode cannot be bypassed", () => {
  it("REVIEW must submit for second-person decision instead of direct approve", () => {
    expect(() => assertTaskCommandAllowed("REVIEW", "APPROVE")).toThrow(/revisi/i);
    expect(() => assertTaskCommandAllowed("REVIEW", "SUBMIT")).not.toThrow();
  });

  it("EXECUTE and APPROVE tasks retain their explicit completion paths", () => {
    expect(() => assertTaskCommandAllowed("EXECUTE", "APPROVE")).not.toThrow();
    expect(() => assertTaskCommandAllowed("APPROVE", "APPROVE")).not.toThrow();
    expect(() => assertTaskCommandAllowed("EXECUTE", "SUBMIT")).toThrow();
  });
});
