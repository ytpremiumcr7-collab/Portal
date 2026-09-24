import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("supplier organization cutover", () => {
  it.each([
    "api/routers/aclaraciones.ts",
    "api/routers/inconformidades.ts",
    "api/routers/garantias.ts",
  ])("%s no longer authorizes by proveedores.usuarioId", (path) => {
    const source = read(path);
    expect(source).not.toMatch(/proveedores\.usuarioId|proveedor\?\.usuarioId/);
    expect(source).toMatch(/supplierProviderIdsForUser|resolveSupplierActor/);
  });
});

describe("real lot-scoped offers", () => {
  it("persists lot identity on offer documents", () => {
    const schema = read("db/schema.ts");
    expect(schema).toMatch(/export const documentos[\s\S]*lotId:\s*bigint\("lot_id"/);
    expect(schema).toContain('index("documentos_tenant_lot_idx").on(t.tenantId, t.lotId)');
  });

  it("offer upload policy checks existing proposition in the selected lot", () => {
    const policy = read("api/lib/document-access.ts");
    expect(policy).toMatch(/lotId:\s*number/);
    expect(policy).toContain("eq(proposiciones.lotId, input.lotId)");
  });

  it("evaluation locks and ranks only the offer lot", () => {
    const source = read("api/routers/participaciones.ts");
    const count = source.split("eq(participaciones.lotId, offer.lotId)").length - 1;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("has an operational lots/items router registered in the app router", () => {
    const router = read("api/router.ts");
    const lots = read("api/routers/lots.ts");
    expect(router).toContain("lots: lotsRouter");
    expect(lots).toContain("procedureLots");
    expect(lots).toContain("procedureItems");
    expect(lots).toMatch(/createLot|crearLote/);
    expect(lots).toMatch(/addItem|agregarItem/);
  });
});
