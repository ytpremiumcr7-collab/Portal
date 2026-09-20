/**
 * National RFC identity: one supplier_legal_entities row per RFC;
 * proveedores are tenant-scoped memberships linked via legal_entity_id.
 */
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { proveedores, supplierLegalEntities, tenants, users } from "@db/schema";

export function normalizeRfc(rfc: string): string {
  return rfc.trim().toUpperCase().replace(/\s+/g, "");
}

export function assertRfcShape(rfc: string): string {
  const n = normalizeRfc(rfc);
  if (![12, 13].includes(n.length) || !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3}$/.test(n)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "RFC mexicano inválido." });
  }
  return n;
}

export type LegalEntityTipo = "PERSONA_FISICA" | "PERSONA_MORAL" | "COOPERATIVA" | "CONSORCIO";

/** Find or create legal entity by RFC inside a transaction. Same RFC = same person nationally. */
export async function findOrCreateLegalEntity(
  tx: any,
  input: { rfc: string; razonSocial: string; tipoPersona: LegalEntityTipo },
): Promise<{ id: number; rfc: string; created: boolean }> {
  const rfc = assertRfcShape(input.rfc);
  const existing = await tx.query.supplierLegalEntities.findFirst({
    where: eq(supplierLegalEntities.rfc, rfc),
  });
  if (existing) {
    return { id: existing.id, rfc: existing.rfc, created: false };
  }
  const result = await tx.insert(supplierLegalEntities).values({
    rfc,
    razonSocial: input.razonSocial.trim(),
    tipoPersona: input.tipoPersona,
  });
  return { id: Number(result[0].insertId), rfc, created: true };
}

/** List tenant memberships for a legal entity (active proveedores). */
export async function listMembershipsByLegalEntityId(db: any, legalEntityId: number) {
  const rows = await db
    .select({
      proveedorId: proveedores.id,
      tenantId: proveedores.tenantId,
      tenantNombre: tenants.nombre,
      rfc: proveedores.rfc,
      razonSocial: proveedores.razonSocial,
      usuarioId: proveedores.usuarioId,
      activo: proveedores.activo,
      estadoVerificacion: proveedores.estadoVerificacion,
    })
    .from(proveedores)
    .innerJoin(tenants, eq(tenants.id, proveedores.tenantId))
    .where(and(eq(proveedores.legalEntityId, legalEntityId), eq(proveedores.activo, true)));
  return rows;
}

/** Resolve login candidates: legal entity by RFC → proveedores with users. */
export async function resolveProveedorLoginCandidates(db: any, rfcRaw: string) {
  const rfc = assertRfcShape(rfcRaw);
  const entity = await db.query.supplierLegalEntities.findFirst({
    where: eq(supplierLegalEntities.rfc, rfc),
  });
  if (!entity) return { entity: null, memberships: [] as any[] };

  const memberships = await db
    .select({
      proveedorId: proveedores.id,
      tenantId: proveedores.tenantId,
      tenantNombre: tenants.nombre,
      usuarioId: proveedores.usuarioId,
      userEmail: users.email,
      userName: users.name,
      passwordHash: users.passwordHash,
      userActivo: users.activo,
      role: users.role,
    })
    .from(proveedores)
    .innerJoin(tenants, eq(tenants.id, proveedores.tenantId))
    .innerJoin(users, and(eq(users.id, proveedores.usuarioId), eq(users.tenantId, proveedores.tenantId)))
    .where(
      and(
        eq(proveedores.legalEntityId, entity.id),
        eq(proveedores.activo, true),
        eq(tenants.activa, true),
      ),
    );

  return { entity, memberships };
}
