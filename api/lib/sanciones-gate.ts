import { and, eq, or, isNull, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { proveedoresImpedidos } from "@db/schema";
import { assertProveedorNoImpedido, canonicalImpedimentoActivo } from "./phase3-transitions";

/** True if proveedor has an active impedimento by vigencia window (canonical). */
export async function isProveedorImpedido(tenantId: number, proveedorId: number, asOf = new Date()) {
  const today = asOf.toISOString().slice(0, 10);
  const db = getDb();
  const rows = await db.select({
    id: proveedoresImpedidos.id,
    activo: proveedoresImpedidos.activo,
    vigenteDesde: proveedoresImpedidos.vigenteDesde,
    vigenteHasta: proveedoresImpedidos.vigenteHasta,
  }).from(proveedoresImpedidos).where(and(
    eq(proveedoresImpedidos.tenantId, tenantId),
    eq(proveedoresImpedidos.proveedorId, proveedorId),
    sql`${proveedoresImpedidos.vigenteDesde} <= ${today}`,
    or(isNull(proveedoresImpedidos.vigenteHasta), sql`${proveedoresImpedidos.vigenteHasta} >= ${today}`),
  )).limit(5);
  return rows.some((r) => canonicalImpedimentoActivo({
    vigenteDesde: r.vigenteDesde as any,
    vigenteHasta: r.vigenteHasta as any,
    asOf: today,
  }));
}

/** Sync `activo` flag from vigencia window so list/gate stay consistent. */
export async function syncImpedimentosActivo(tenantId?: number) {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const conditions = tenantId != null ? [eq(proveedoresImpedidos.tenantId, tenantId)] : [];
  const rows = await db.select().from(proveedoresImpedidos).where(conditions.length ? and(...conditions) : undefined);
  let updated = 0;
  for (const r of rows) {
    const should = canonicalImpedimentoActivo({
      vigenteDesde: r.vigenteDesde as any,
      vigenteHasta: r.vigenteHasta as any,
      asOf: today,
    });
    if (Boolean(r.activo) !== should) {
      await db.update(proveedoresImpedidos).set({ activo: should })
        .where(and(eq(proveedoresImpedidos.id, r.id), eq(proveedoresImpedidos.tenantId, r.tenantId)));
      updated++;
    }
  }
  return { scanned: rows.length, updated };
}

export async function assertProveedorPuedeParticipar(tenantId: number, proveedorId: number) {
  assertProveedorNoImpedido(await isProveedorImpedido(tenantId, proveedorId), "participacion");
}

export async function assertProveedorPuedeAdjudicarse(tenantId: number, proveedorId: number) {
  assertProveedorNoImpedido(await isProveedorImpedido(tenantId, proveedorId), "adjudicacion");
}
