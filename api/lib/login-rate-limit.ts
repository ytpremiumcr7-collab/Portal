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

async function touch(scope: "IP" | "ACCOUNT", scopeKey: string, failed: boolean) {
  const db = getDb();
  const now = new Date();
  const row = await db.query.loginRateLimits.findFirst({
    where: and(eq(loginRateLimits.scope, scope), eq(loginRateLimits.scopeKey, scopeKey)),
  });
  if (!row) {
    if (!failed) return;
    await db.insert(loginRateLimits).values({
      scope, scopeKey, failCount: 1, windowStartedAt: now, lastFailAt: now, lockedUntil: null,
    } as any);
    return;
  }
  if (row.lockedUntil && row.lockedUntil > now) {
    const wait = Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Inicio de sesión bloqueado temporalmente (${wait}s). MFA/step-up es el siguiente control previsto.`,
    });
  }
  const windowStart = row.windowStartedAt?.getTime() ?? now.getTime();
  const inWindow = now.getTime() - windowStart < WINDOW_MS;
  if (!failed) {
    await db.update(loginRateLimits).set({ failCount: 0, lockedUntil: null, windowStartedAt: now } as any)
      .where(and(eq(loginRateLimits.scope, scope), eq(loginRateLimits.scopeKey, scopeKey)));
    return;
  }
  const failCount = inWindow ? Number(row.failCount) + 1 : 1;
  const lockSec = lockSecondsFor(failCount);
  const lockedUntil = lockSec > 0 ? new Date(now.getTime() + lockSec * 1000) : null;
  await db.update(loginRateLimits).set({
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
}

export async function assertLoginAllowed(ip: string | null, email: string) {
  if (ip) await touch("IP", ip.slice(0, 255), false).catch(() => undefined);
  // Pre-check locks without incrementing
  const db = getDb();
  const now = new Date();
  for (const [scope, key] of [["IP", ip], ["ACCOUNT", email.toLowerCase()]] as const) {
    if (!key) continue;
    const row = await db.query.loginRateLimits.findFirst({
      where: and(eq(loginRateLimits.scope, scope), eq(loginRateLimits.scopeKey, key.slice(0, 255))),
    });
    if (row?.lockedUntil && row.lockedUntil > now) {
      const wait = Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000);
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Inicio de sesión bloqueado temporalmente (${wait}s). MFA/step-up es el siguiente control previsto.`,
      });
    }
  }
}

export async function recordLoginFailure(ip: string | null, email: string) {
  if (ip) await touch("IP", ip.slice(0, 255), true);
  await touch("ACCOUNT", email.toLowerCase().slice(0, 255), true);
}

export async function recordLoginSuccess(ip: string | null, email: string) {
  if (ip) await touch("IP", ip.slice(0, 255), false);
  await touch("ACCOUNT", email.toLowerCase().slice(0, 255), false);
}
