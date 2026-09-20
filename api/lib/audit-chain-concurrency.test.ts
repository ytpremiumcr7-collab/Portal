import "dotenv/config";
import { describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { writeAudit, verifyAuditHashChain } from "./security";
import { auditLog, tenants } from "@db/schema";
import { ensureSystemActor } from "./system-actor";
import { randomUUID } from "node:crypto";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("audit chain concurrency (real DB)", () => {
  it("concurrent writeAudit calls for isolated tenant produce a single linear chain", async () => {
    const db = getDb();
    const slug = `audit-conc-${randomUUID().slice(0, 8)}`;
    const rfc = (`AAA${randomUUID().replace(/-/g, "").slice(0, 9)}`).slice(0, 12).toUpperCase();
    const ins = await db.insert(tenants).values({
      nombre: `Audit Conc ${slug}`,
      slug,
      rfc,
    } as any);
    const tenantId = Number(ins[0].insertId);
    expect(tenantId).toBeGreaterThan(0);

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
    expect(hashed.length).toBeGreaterThanOrEqual(N);
    expect(new Set(hashed.map((e) => e.eventHash)).size).toBe(hashed.length);

    let prev: string | null = null;
    for (const row of hashed) {
      expect(row.previousHash).toBe(prev);
      prev = row.eventHash;
    }
  }, 60_000);
});
