import { and, eq, or, isNull, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { proveedoresImpedidos } from "@db/schema";
import { assertProveedorNoImpedido } from "./phase3-transitions";

/** True if proveedor has an active impedimento (sanción vigente). */
export async function isProveedorImpedido(tenantId: number, proveedorId: number, asOf = new Date()) {
  const today = asOf.toISOString().slice(0, 10);
  const db = getDb();
  const rows = await db.select({ id: proveedoresImpedidos.id }).from(proveedoresImpedidos).where(and(
    eq(proveedoresImpedidos.tenantId, tenantId),
    eq(proveedoresImpedidos.proveedorId, proveedorId),
    eq(proveedoresImpedidos.activo, true),
    sql`${proveedoresImpedidos.vigenteDesde} <= ${today}`,
    or(isNull(proveedoresImpedidos.vigenteHasta), sql`${proveedoresImpedidos.vigenteHasta} >= ${today}`),
  )).limit(1);
  return rows.length > 0;
}

export async function assertProveedorPuedeParticipar(tenantId: number, proveedorId: number) {
  assertProveedorNoImpedido(await isProveedorImpedido(tenantId, proveedorId), "participacion");
}

export async function assertProveedorPuedeAdjudicarse(tenantId: number, proveedorId: number) {
  assertProveedorNoImpedido(await isProveedorImpedido(tenantId, proveedorId), "adjudicacion");
}
