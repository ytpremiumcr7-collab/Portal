import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import * as cookie from "cookie";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull, gt } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { auditLog, sessions, users } from "@db/schema";
import { Session, ErrorMessages } from "@contracts/constants";

const scrypt = promisify(scryptCb);
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

export function requestMeta(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ipAddress: forwarded || req.headers.get("x-real-ip") || null,
    userAgent: req.headers.get("user-agent"),
    requestId: req.headers.get("x-request-id") || randomUUID(),
  };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64, {
    N: PASSWORD_N,
    r: PASSWORD_R,
    p: PASSWORD_P,
  })) as Buffer;
  return `scrypt$${PASSWORD_N}$${PASSWORD_R}$${PASSWORD_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  const derived = (await scrypt(password, Buffer.from(saltHex, "hex"), 64, {
    N: Number(n), r: Number(r), p: Number(p),
  })) as Buffer;
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
  const row = await getDb().query.sessions.findFirst({
    where: and(
      eq(sessions.tokenHash, hashToken(token)),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, new Date()),
    ),
    with: { user: true },
  });
  if (!row?.user || !row.user.activo) return null;
  return row.user;
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

export async function writeAudit(input: {
  ctx: RequestContext;
  accion: string;
  entidad: string;
  entidadId?: number | null;
  valorAnterior?: unknown;
  valorNuevo?: unknown;
  motivo?: string | null;
}) {
  await getDb().insert(auditLog).values({
    tenantId: input.ctx.user.tenantId,
    actorUserId: input.ctx.user.id,
    accion: input.accion,
    entidad: input.entidad,
    entidadId: input.entidadId ?? null,
    valorAnterior: input.valorAnterior == null ? null : JSON.stringify(sanitizeAuditValue(input.valorAnterior)),
    valorNuevo: input.valorNuevo == null ? null : JSON.stringify(sanitizeAuditValue(input.valorNuevo)),
    ipAddress: input.ctx.ipAddress,
    userAgent: input.ctx.userAgent,
    motivo: input.motivo ?? null,
    requestId: input.ctx.requestId,
  });
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
