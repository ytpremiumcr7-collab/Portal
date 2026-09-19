import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const ENVELOPE_ALGORITHM = "AES-256-GCM" as const;
export const ENVELOPE_PLACEHOLDER_MONTO = "0.00";

export type EnvelopeAadContext = {
  tenantId: number;
  licitacionId: number;
  participacionId: number;
  proposicionId: number | null;
  keyVersion: number;
};

export type EnvelopeSeal = {
  ciphertext: string;
  nonceIv: string;
  authTag: string;
  keyVersion: number;
  algorithm: typeof ENVELOPE_ALGORITHM;
  aad?: string;
};

function parseKeyMaterial(raw: string): Buffer {
  const t = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(t)) return Buffer.from(t, "hex");
  const b64 = Buffer.from(t, "base64");
  if (b64.length === 32) return b64;
  throw new Error("ARES_ENVELOPE_KEY must be 32-byte base64 or 64-char hex");
}

/** Active write key version (rotation stub). */
export function currentEnvelopeKeyVersion(): number {
  const n = Number(process.env.ARES_ENVELOPE_KEY_VERSION ?? 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * Resolve key by version.
 * v = current → ARES_ENVELOPE_KEY
 * else → ARES_ENVELOPE_KEY_V{n} (rotation stub for decrypt of older envelopes)
 */
export function resolveEnvelopeKey(version: number): Buffer {
  if (version === currentEnvelopeKeyVersion()) {
    const raw = process.env.ARES_ENVELOPE_KEY?.trim();
    if (!raw) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("ARES_ENVELOPE_KEY required in production");
      }
      return parseKeyMaterial(Buffer.from("piedra-angular-dev-envelope-key!!").toString("base64"));
    }
    return parseKeyMaterial(raw);
  }
  const legacy = process.env[`ARES_ENVELOPE_KEY_V${version}`]?.trim();
  if (!legacy) throw new Error(`Missing ARES_ENVELOPE_KEY_V${version} for keyVersion=${version}`);
  return parseKeyMaterial(legacy);
}

/** Canonical AAD binding: tenant:licitacion:participacion:proposicion:keyVersion */
export function buildEnvelopeAad(ctx: EnvelopeAadContext): string {
  const prop = ctx.proposicionId == null ? "0" : String(ctx.proposicionId);
  return `${ctx.tenantId}:${ctx.licitacionId}:${ctx.participacionId}:${prop}:${ctx.keyVersion}`;
}

/** SHA-256 of ciphertext (base64 payload) for manifest/seal without decrypt. */
export function ciphertextHash(ciphertextB64: string): string {
  return createHash("sha256").update(ciphertextB64, "utf8").digest("hex");
}

/** Encrypt monto (decimal string) with AES-256-GCM + AAD binding. */
export function sealMontoOferta(monto: string | number, aadCtx: EnvelopeAadContext): EnvelopeSeal {
  const plain = Number(monto).toFixed(2);
  if (!Number.isFinite(Number(plain)) || Number(plain) <= 0) {
    throw new Error("montoOferta inválido para sellado");
  }
  const keyVersion = aadCtx.keyVersion || currentEnvelopeKeyVersion();
  const key = resolveEnvelopeKey(keyVersion);
  const aad = buildEnvelopeAad({ ...aadCtx, keyVersion });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString("base64"),
    nonceIv: iv.toString("base64"),
    authTag: tag.toString("base64"),
    keyVersion,
    algorithm: ENVELOPE_ALGORITHM,
    aad,
  };
}

/** Decrypt sealed envelope → decimal string with 2 places. AAD must match or GCM fails. */
export function openMontoOferta(
  seal: {
    ciphertext: string;
    nonceIv: string;
    authTag: string;
    keyVersion: number;
    algorithm?: string;
  },
  aadCtx: EnvelopeAadContext,
): string {
  if (seal.algorithm && seal.algorithm !== ENVELOPE_ALGORITHM) {
    throw new Error(`Unsupported envelope algorithm: ${seal.algorithm}`);
  }
  const key = resolveEnvelopeKey(seal.keyVersion);
  const aad = buildEnvelopeAad({ ...aadCtx, keyVersion: seal.keyVersion });
  const iv = Buffer.from(seal.nonceIv, "base64");
  const tag = Buffer.from(seal.authTag, "base64");
  const data = Buffer.from(seal.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  const n = Number(plain);
  if (!Number.isFinite(n) || n < 0) throw new Error("Decrypted montoOferta inválido");
  return n.toFixed(2);
}

/** True when ciphertext is not a trivial encoding of the plaintext decimal. */
export function ciphertextDiffersFromPlaintext(ciphertextB64: string, monto: string): boolean {
  const plain = Number(monto).toFixed(2);
  try {
    const decoded = Buffer.from(ciphertextB64, "base64").toString("utf8");
    if (decoded === plain) return false;
  } catch { /* ignore */ }
  return ciphertextB64 !== plain && ciphertextB64 !== Buffer.from(plain, "utf8").toString("base64");
}
