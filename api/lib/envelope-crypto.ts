import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const ENVELOPE_ALGORITHM = "AES-256-GCM" as const;
export const ENVELOPE_PLACEHOLDER_MONTO = "0.00";

export type EnvelopeSeal = {
  ciphertext: string;
  nonceIv: string;
  authTag: string;
  keyVersion: number;
  algorithm: typeof ENVELOPE_ALGORITHM;
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
      // Deterministic dev fallback (NOT for production) — 32 zero-ish derived bytes from label
      return parseKeyMaterial(Buffer.from("piedra-angular-dev-envelope-key!!").toString("base64"));
    }
    return parseKeyMaterial(raw);
  }
  const legacy = process.env[`ARES_ENVELOPE_KEY_V${version}`]?.trim();
  if (!legacy) throw new Error(`Missing ARES_ENVELOPE_KEY_V${version} for keyVersion=${version}`);
  return parseKeyMaterial(legacy);
}

/** Encrypt monto (decimal string) with AES-256-GCM. */
export function sealMontoOferta(monto: string | number): EnvelopeSeal {
  const plain = Number(monto).toFixed(2);
  if (!Number.isFinite(Number(plain)) || Number(plain) <= 0) {
    throw new Error("montoOferta inválido para sellado");
  }
  const keyVersion = currentEnvelopeKeyVersion();
  const key = resolveEnvelopeKey(keyVersion);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString("base64"),
    nonceIv: iv.toString("base64"),
    authTag: tag.toString("base64"),
    keyVersion,
    algorithm: ENVELOPE_ALGORITHM,
  };
}

/** Decrypt sealed envelope → decimal string with 2 places. */
export function openMontoOferta(seal: {
  ciphertext: string;
  nonceIv: string;
  authTag: string;
  keyVersion: number;
  algorithm?: string;
}): string {
  if (seal.algorithm && seal.algorithm !== ENVELOPE_ALGORITHM) {
    throw new Error(`Unsupported envelope algorithm: ${seal.algorithm}`);
  }
  const key = resolveEnvelopeKey(seal.keyVersion);
  const iv = Buffer.from(seal.nonceIv, "base64");
  const tag = Buffer.from(seal.authTag, "base64");
  const data = Buffer.from(seal.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
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
