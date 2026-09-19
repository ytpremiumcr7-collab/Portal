import "dotenv/config";
import { describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { writeAudit, verifyAuditHashChain } from "./security";
import { auditLog } from "@db/schema";
import { ensureSystemActor } from "./system-actor";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("audit chain concurrency (real DB)", () => {
  it("concurrent writeAudit calls for same tenant produce a single linear chain", async () => {
    const db = getDb();
    const tenant = await db.query.tenants.findFirst({ columns: { id: true } });
    const tenantId = Number(tenant?.id ?? 0);
    if (!tenantId) {
      // No tenant seeded — create minimal via ensure path is skipped
      expect(tenantId).toBeGreaterThan(0);
      return;
    }
    const actor = await ensureSystemActor(db, tenantId);

    const N = 24;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        writeAudit({
          ctx: {
            user: {
              id: actor.id,
              tenantId,
              role: "admin",
              email: actor.email,
              name: "SYSTEM",
            } as any,
            ipAddress: "127.0.0.1",
            userAgent: "audit-concurrency-test",
            requestId: `conc-${Date.now()}-${i}`,
          },
          accion: "TEST_CONCURRENCY",
          entidad: "audit_chain_stress",
          entidadId: i + 1,
          valorNuevo: { i },
          motivo: `stress-${i}`,
        }),
      ),
    );

    const verify = await verifyAuditHashChain(tenantId);
    expect(verify.valid).toBe(true);

    const events = await db
      .select({
        id: auditLog.id,
        eventHash: auditLog.eventHash,
        previousHash: auditLog.previousHash,
      })
      .from(auditLog)
      .where(eq(auditLog.tenantId, tenantId))
      .orderBy(asc(auditLog.id));

    const hashed = events.filter((e) => e.eventHash);
    expect(new Set(hashed.map((e) => e.eventHash)).size).toBe(hashed.length);

    let prev: string | null = null;
    let started = false;
    for (const row of hashed) {
      if (!started) {
        started = true;
        prev = null;
      }
      expect(row.previousHash).toBe(prev);
      prev = row.eventHash;
    }
  }, 60_000);
});
