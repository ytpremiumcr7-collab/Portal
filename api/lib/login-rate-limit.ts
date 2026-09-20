import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../queries/connection";
import { loginRateLimits } from "@db/schema";

const WINDOW_MS = 15 * 60 * 1000;
/** Progressive lockouts: fails → lock seconds */
const LOCK_SCHEDULE = [
  { fails: 5, lockSec: 30 },
  { fails: 8, lockSec: 120 },
  { fails: 12, lockSec: 600 },
  { fails: 20, lockSec: 3600 },
];

function lockSecondsFor(fails: number): number {
  let lock = 0;
  for (const step of LOCK_SCHEDULE) {
    if (fails >= step.fails) lock = step.lockSec;
  }
  return lock;
}

function tooMany(waitSec: number): never {
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: `Inicio de sesión bloqueado temporalmente (${waitSec}s). MFA/step-up es el siguiente control previsto.`,
  });
}

function storeError(op: string, err: unknown): never {
  const detail = err instanceof Error ? err.message : String(err);
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `Control de tasa de acceso indisponible (${op}); login denegado (fail-closed). ${detail}`,
  });
}

/** Read lock state without mutating counters. */
async function assertNotLocked(scope: "IP" | "ACCOUNT", scopeKey: string) {
  try {
    const db = getDb();
    const now = new Date();
    const row = await db.query.loginRateLimits.findFirst({
      where: and(eq(loginRateLimits.scope, scope), eq(loginRateLimits.scopeKey, scopeKey)),
    });
    if (row?.lockedUntil && row.lockedUntil > now) {
      const wait = Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000);
      tooMany(wait);
    }
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    storeError("assertNotLocked", e);
  }
}

/**
 * Persist a failed attempt. Uses row lock so concurrent failures cannot wipe/reset the bucket.
 * Window resets only when the previous window has fully elapsed — never on a mere pre-check.
 */
async function recordFailure(scope: "IP" | "ACCOUNT", scopeKey: string) {
  try {
    const db = getDb();
    await db.transaction(async (tx) => {
      const now = new Date();
      const locked = await tx
        .select()
        .from(loginRateLimits)
        .where(and(eq(loginRateLimits.scope, scope), eq(loginRateLimits.scopeKey, scopeKey)))
        .for("update")
        .limit(1);
      const row = locked[0];
      if (!row) {
        await tx.insert(loginRateLimits).values({
          scope,
          scopeKey,
          failCount: 1,
          windowStartedAt: now,
          lastFailAt: now,
          lockedUntil: null,
        } as any);
        return;
      }
      if (row.lockedUntil && row.lockedUntil > now) {
        const wait = Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000);
        tooMany(wait);
      }
      const windowStart = row.windowStartedAt?.getTime() ?? now.getTime();
      const inWindow = now.getTime() - windowStart < WINDOW_MS;
      const failCount = inWindow ? Number(row.failCount) + 1 : 1;
      const lockSec = lockSecondsFor(failCount);
      const lockedUntil = lockSec > 0 ? new Date(now.getTime() + lockSec * 1000) : null;
      await tx.update(loginRateLimits).set({
        failCount,
        windowStartedAt: inWindow ? row.windowStartedAt : now,
        lastFailAt: now,
        lockedUntil,
      } as any).where(and(eq(loginRateLimits.scope, scope), eq(loginRateLimits.scopeKey, scopeKey)));
      if (lockedUntil) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Demasiados intentos fallidos. Bloqueado ${lockSec}s. (MFA/step-up documentado como siguiente endurecimiento.)`,
        });
      }
    });
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    storeError("recordFailure", e);
  }
}

/** Clear counters only after authenticated success — never from pre-check. */
async function clearOnSuccess(scope: "IP" | "ACCOUNT", scopeKey: string) {
  try {
    const db = getDb();
    const now = new Date();
    await db.update(loginRateLimits).set({
      failCount: 0,
      lockedUntil: null,
      windowStartedAt: now,
    } as any).where(and(eq(loginRateLimits.scope, scope), eq(loginRateLimits.scopeKey, scopeKey)));
  } catch (e) {
    // Success path: fail-open on clear so a store blip does not block a valid login after auth.
    console.error("[login-rate-limit] clearOnSuccess failed", scope, scopeKey, e);
  }
}

/**
 * Pre-login gate: ONLY checks locks. Must NOT reset failCount / wipe the IP bucket.
 * Fail-closed on store errors.
 */
export async function assertLoginAllowed(ip: string | null, email: string) {
  if (ip) await assertNotLocked("IP", ip.slice(0, 255));
  await assertNotLocked("ACCOUNT", email.toLowerCase().slice(0, 255));
}

export async function recordLoginFailure(ip: string | null, email: string) {
  if (ip) await recordFailure("IP", ip.slice(0, 255));
  await recordFailure("ACCOUNT", email.toLowerCase().slice(0, 255));
}

export async function recordLoginSuccess(ip: string | null, email: string) {
  if (ip) await clearOnSuccess("IP", ip.slice(0, 255));
  await clearOnSuccess("ACCOUNT", email.toLowerCase().slice(0, 255));
}

/** Test helpers */
export const __loginRateLimitTest = {
  WINDOW_MS,
  lockSecondsFor,
};
