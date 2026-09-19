import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { users, tenants } from "@db/schema";

/** Documented legacy / demo alias (single tenant). Prefer systemActorEmail(tenantId). */
export const SYSTEM_ACTOR_EMAIL = "system@piedra-angular.local";
export const SYSTEM_ACTOR_SENTINEL = "SYSTEM" as const;

/** Per-tenant system actor email (global email unique constraint). */
export function systemActorEmail(tenantId: number): string {
  return `system+t${tenantId}@piedra-angular.local`;
}

/**
 * Ensure a non-interactive system user exists for the tenant.
 * - passwordHash NULL → login rejected
 * - activo false → login rejected
 * Used as outbox/notification actor; never invent userId=1.
 */
export async function ensureSystemActor(
  dbOrTx: any,
  tenantId: number,
): Promise<{ id: number; email: string; created: boolean }> {
  const email = systemActorEmail(tenantId);
  const existing = await dbOrTx.query.users.findFirst({
    where: and(eq(users.tenantId, tenantId), eq(users.email, email)),
    columns: { id: true, email: true },
  });
  if (existing?.id) return { id: existing.id, email: existing.email, created: false };

  // Legacy single-tenant alias
  if (tenantId === 1) {
    const legacy = await dbOrTx.query.users.findFirst({
      where: and(eq(users.tenantId, tenantId), eq(users.email, SYSTEM_ACTOR_EMAIL)),
      columns: { id: true, email: true },
    });
    if (legacy?.id) return { id: legacy.id, email: legacy.email, created: false };
  }

  const result = await dbOrTx.insert(users).values({
    tenantId,
    unionId: `system:${tenantId}:${randomUUID()}`,
    name: "SYSTEM",
    email,
    passwordHash: null,
    role: "admin",
    activo: false,
  } as any);
  const id = Number(result[0].insertId);
  return { id, email, created: true };
}

/** Resolve system actor id or null (fail closed — never return 1 inventively). */
export async function resolveSystemActorId(dbOrTx: any, tenantId: number): Promise<number | null> {
  const email = systemActorEmail(tenantId);
  const row = await dbOrTx.query.users.findFirst({
    where: and(eq(users.tenantId, tenantId), eq(users.email, email)),
    columns: { id: true },
  });
  if (row?.id) return row.id;
  if (tenantId === 1) {
    const legacy = await dbOrTx.query.users.findFirst({
      where: and(eq(users.tenantId, tenantId), eq(users.email, SYSTEM_ACTOR_EMAIL)),
      columns: { id: true },
    });
    if (legacy?.id) return legacy.id;
  }
  return null;
}

/**
 * Ensure every existing tenant has a system actor (not only on first outbox claim).
 * Safe to call from seed / migrate / boot ops paths.
 */
export async function ensureSystemActorsForAllTenants(
  dbOrTx: any,
): Promise<{ tenants: number; created: number; ensured: number }> {
  const rows = await dbOrTx.select({ id: tenants.id }).from(tenants);
  let created = 0;
  let ensured = 0;
  for (const row of rows) {
    const r = await ensureSystemActor(dbOrTx, Number(row.id));
    ensured += 1;
    if (r.created) created += 1;
  }
  return { tenants: rows.length, created, ensured };
}
