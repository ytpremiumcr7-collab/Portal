import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual, type BinaryLike, type ScryptOptions } from "node:crypto";
import * as cookie from "cookie";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull, gt, asc } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { auditLog, auditChainHeads, sessions, tenants, users } from "@db/schema";
import { Session, ErrorMessages } from "@contracts/constants";

/** Promisified scrypt that keeps the options overload (@types/node + util.promisify only sees the 3-arg form). */
function scrypt(password: BinaryLike, salt: BinaryLike, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}
const PASSWORD_N = 16384;
const PASSWORD_R = 8;
const PASSWORD_P = 1;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export type RequestContext = {
  user: typeof users.$inferSelect;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string;
};

export function requestMeta(req: Request, opts?: { trustProxy?: boolean; socketIp?: string | null }) {
  const trustProxy = opts?.trustProxy ?? process.env.ARES_TRUST_PROXY === "true";
  let ipAddress: string | null = null;
  if (trustProxy) {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    ipAddress = forwarded || req.headers.get("x-real-ip") || opts?.socketIp || null;
  } else {
    // Direct / socket only — do not trust client-controlled X-Forwarded-For.
    ipAddress = opts?.socketIp || null;
  }
  return {
    ipAddress,
    userAgent: req.headers.get("user-agent"),
    requestId: req.headers.get("x-request-id") || randomUUID(),
  };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, {
    N: PASSWORD_N,
    r: PASSWORD_R,
    p: PASSWORD_P,
  });
  return `scrypt$${PASSWORD_N}$${PASSWORD_R}$${PASSWORD_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  const derived = await scrypt(password, Buffer.from(saltHex, "hex"), 64, {
    N: Number(n), r: Number(r), p: Number(p),
  });
  const expected = Buffer.from(hashHex, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export async function createSession(user: typeof users.$inferSelect, req: Request) {
  const raw = randomBytes(48).toString("base64url");
  const now = Date.now();
  await getDb().insert(sessions).values({
    tenantId: user.tenantId,
    userId: user.id,
    tokenHash: hashToken(raw),
    expiresAt: new Date(now + SESSION_TTL_MS),
    ipAddress: requestMeta(req).ipAddress,
    userAgent: requestMeta(req).userAgent,
  });
  return raw;
}

export async function authenticateRequest(headers: Headers) {
  const cookies = cookie.parse(headers.get("cookie") || "");
  const token = cookies[Session.cookieName];
  if (!token) return null;
  const db = getDb();
  const [row] = await db.select().from(sessions).where(and(
    eq(sessions.tokenHash, hashToken(token)),
    isNull(sessions.revokedAt),
    gt(sessions.expiresAt, new Date()),
  )).limit(1);
  if (!row) return null;
  const [user] = await db.select().from(users).where(and(eq(users.id, row.userId), eq(users.tenantId, row.tenantId))).limit(1);
  if (!user?.activo) return null;
  const [tenant] = await db.select({ activa: tenants.activa, deletedAt: tenants.deletedAt }).from(tenants).where(eq(tenants.id, user.tenantId)).limit(1);
  if (tenant && (!tenant.activa || tenant.deletedAt != null)) return null;
  return user;
}

export function requireRoles(user: typeof users.$inferSelect, roles: Array<typeof users.$inferSelect.role>) {
  if (!roles.includes(user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: ErrorMessages.insufficientRole });
  }
}

export async function revokeSession(req: Request) {
  const cookies = cookie.parse(req.headers.get("cookie") || "");
  const token = cookies[Session.cookieName];
  if (!token) return;
  await getDb().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(token)));
}

function sanitizeAuditValue(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (["passwordHash", "contentBase64", "tokenHash", "storageKey"].includes(key)) {
      if (key === "storageKey") out[key] = "[REDACTED_STORAGE_KEY]";
      else out[key] = "[REDACTED]";
      continue;
    }
    out[key] = sanitizeAuditValue(item);
  }
  return out;
}

function canonicalAuditEvent(input: {
  tenantId: number;
  actorUserId: number;
  accion: string;
  entidad: string;
  entidadId: number | null;
  valorAnterior: unknown;
  valorNuevo: unknown;
  motivo: string | null;
  requestId: string | null;
  timestamp: string;
  previousHash: string | null;
}) {
  return JSON.stringify(input);
}

/** Append-only audit with per-tenant hash chain serialized via audit_chain_heads FOR UPDATE. */
export async function writeAudit(input: {
  ctx: RequestContext;
  accion: string;
  entidad: string;
  entidadId?: number | null;
  valorAnterior?: unknown;
  valorNuevo?: unknown;
  motivo?: string | null;
  /** Optional outer transaction — when provided, mutation + audit share one TX. */
  tx?: any;
}) {
  const db = getDb();
  const tenantId = input.ctx.user.tenantId;
  const valorAnterior = input.valorAnterior == null ? null : sanitizeAuditValue(input.valorAnterior);
  const valorNuevo = input.valorNuevo == null ? null : sanitizeAuditValue(input.valorNuevo);
  const motivo = input.motivo ?? null;
  const entidadId = input.entidadId ?? null;
  const timestamp = new Date().toISOString();

  const run = async (tx: any) => {
    // Serialize chain head per tenant
    let head = await tx.select().from(auditChainHeads).where(eq(auditChainHeads.tenantId, tenantId)).for("update");
    if (!head.length) {
      await tx.insert(auditChainHeads).values({ tenantId, lastEventHash: null, lastAuditId: null } as any);
      head = await tx.select().from(auditChainHeads).where(eq(auditChainHeads.tenantId, tenantId)).for("update");
    }
    const previousHash = (head[0]?.lastEventHash as string | null) ?? null;
    const base = canonicalAuditEvent({
      tenantId,
      actorUserId: input.ctx.user.id,
      accion: input.accion,
      entidad: input.entidad,
      entidadId,
      valorAnterior,
      valorNuevo,
      motivo,
      requestId: input.ctx.requestId ?? null,
      timestamp,
      previousHash,
    });
    const eventHash = createHash("sha256").update(base).digest("hex");
    const inserted = await tx.insert(auditLog).values({
      tenantId,
      actorUserId: input.ctx.user.id,
      accion: input.accion,
      entidad: input.entidad,
      entidadId,
      valorAnterior: valorAnterior == null ? null : JSON.stringify(valorAnterior),
      valorNuevo: valorNuevo == null ? null : JSON.stringify(valorNuevo),
      timestamp: new Date(timestamp),
      ipAddress: input.ctx.ipAddress,
      userAgent: input.ctx.userAgent,
      motivo,
      requestId: input.ctx.requestId,
      previousHash,
      eventHash,
    });
    const auditId = Number(inserted[0].insertId);
    await tx.update(auditChainHeads).set({
      lastEventHash: eventHash,
      lastAuditId: auditId,
    } as any).where(eq(auditChainHeads.tenantId, tenantId));
  };

  if (input.tx) await run(input.tx);
  else await db.transaction(async (tx) => run(tx));
}

export async function verifyAuditHashChain(tenantId: number) {
  const db = getDb();
  const rows = await db.query.auditLog.findMany({
    where: eq(auditLog.tenantId, tenantId),
    orderBy: [asc(auditLog.id)],
  });
  const hashed = rows.filter((r) => r.eventHash);
  let previous: string | null = null;
  let started = false;
  for (const row of hashed) {
    if (!started) {
      // First hashed row may start a new chain (previousHash null) after legacy rows.
      started = true;
      previous = null;
    }
    if (row.previousHash !== previous) return { valid: false, brokenAt: row.id };
    let valorAnterior: unknown = null;
    let valorNuevo: unknown = null;
    try {
      valorAnterior = row.valorAnterior ? JSON.parse(row.valorAnterior) : null;
      valorNuevo = row.valorNuevo ? JSON.parse(row.valorNuevo) : null;
    } catch {
      return { valid: false, brokenAt: row.id };
    }
    const base = canonicalAuditEvent({
      tenantId: row.tenantId,
      actorUserId: row.actorUserId,
      accion: row.accion,
      entidad: row.entidad,
      entidadId: row.entidadId ?? null,
      valorAnterior,
      valorNuevo,
      motivo: row.motivo ?? null,
      requestId: row.requestId ?? null,
      timestamp: row.timestamp.toISOString(),
      previousHash: row.previousHash ?? null,
    });
    const expected = createHash("sha256").update(base).digest("hex");
    if (expected !== row.eventHash) return { valid: false, brokenAt: row.id };
    previous = row.eventHash;
  }
  return { valid: true, brokenAt: null, events: hashed.length };
}

export function clearSessionCookie(resHeaders: Headers) {
  resHeaders.append("set-cookie", cookie.serialize(Session.cookieName, "", {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  }));
}

export function setSessionCookie(resHeaders: Headers, token: string) {
  resHeaders.append("set-cookie", cookie.serialize(Session.cookieName, token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS / 1000,
  }));
}

export function assertNonNegativeDecimal(value: string, field: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) < 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${field} debe ser un importe no negativo con hasta 2 decimales.` });
  }
}

export function assertScore(value: string | number, field: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${field} debe estar entre 0 y 100.` });
  }
}

export function assertPositiveDays(value: number | null | undefined, field: string) {
  if (value != null && (!Number.isInteger(value) || value <= 0)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${field} debe ser un número entero positivo.` });
  }
}
