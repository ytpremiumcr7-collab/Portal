/**
 * Pluggable envelope DEK provider.
 *
 * Default: EnvKeyProvider (software key material from ARES_ENVELOPE_KEY / ARES_ENVELOPE_KEY_V{n}).
 * Stubs: AwsKmsKeyProvider / VaultTransitKeyProvider — interface ready; require real credentials.
 *
 * Do NOT claim HSM/KMS in production until a non-Env provider is configured with live creds.
 */

export interface EnvelopeKeyProvider {
  readonly name: string;
  /** Resolve 32-byte AES key for the given version (sync for Env; async reserved for KMS). */
  resolveKey(version: number): Buffer | Promise<Buffer>;
  currentVersion(): number;
}

function parseKeyMaterial(raw: string): Buffer {
  const t = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(t)) return Buffer.from(t, "hex");
  const b64 = Buffer.from(t, "base64");
  if (b64.length === 32) return b64;
  throw new Error("Envelope key must be 32-byte base64 or 64-char hex");
}

export class EnvKeyProvider implements EnvelopeKeyProvider {
  readonly name = "env";
  currentVersion(): number {
    const n = Number(process.env.ARES_ENVELOPE_KEY_VERSION ?? 1);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  }
  resolveKey(version: number): Buffer {
    if (version === this.currentVersion()) {
      const raw = process.env.ARES_ENVELOPE_KEY?.trim();
      if (!raw) {
        if (process.env.NODE_ENV === "production") throw new Error("ARES_ENVELOPE_KEY required in production");
        return parseKeyMaterial(Buffer.from("piedra-angular-dev-envelope-key!!").toString("base64"));
      }
      return parseKeyMaterial(raw);
    }
    const legacy = process.env[`ARES_ENVELOPE_KEY_V${version}`]?.trim();
    if (!legacy) throw new Error(`Missing ARES_ENVELOPE_KEY_V${version}`);
    return parseKeyMaterial(legacy);
  }
}

/** Stub — wire AWS KMS Decrypt/GenerateDataKey when credentials exist. */
export class AwsKmsKeyProvider implements EnvelopeKeyProvider {
  readonly name = "aws-kms";
  private readonly keyId: string;
  constructor(keyId: string) {
    this.keyId = keyId;
  }
  currentVersion(): number {
    return Number(process.env.ARES_ENVELOPE_KEY_VERSION ?? 1) || 1;
  }
  resolveKey(_version: number): Buffer {
    void this.keyId;
    throw new Error("AwsKmsKeyProvider stub: configure AWS credentials + KMS unwrap (not fakeable).");
  }
}

/** Stub — HashiCorp Vault transit decrypt interface. */
export class VaultTransitKeyProvider implements EnvelopeKeyProvider {
  readonly name = "vault-transit";
  private readonly mountPath: string;
  private readonly keyName: string;
  constructor(mountPath: string, keyName: string) {
    this.mountPath = mountPath;
    this.keyName = keyName;
  }
  currentVersion(): number {
    return Number(process.env.ARES_ENVELOPE_KEY_VERSION ?? 1) || 1;
  }
  resolveKey(_version: number): Buffer {
    void this.mountPath; void this.keyName;
    throw new Error("VaultTransitKeyProvider stub: configure VAULT_ADDR/TOKEN + transit key (not fakeable).");
  }
}

let active: EnvelopeKeyProvider = new EnvKeyProvider();

export function getEnvelopeKeyProvider(): EnvelopeKeyProvider {
  return active;
}

export function setEnvelopeKeyProvider(provider: EnvelopeKeyProvider) {
  active = provider;
}

/** Factory from env: ARES_ENVELOPE_PROVIDER=env|aws-kms|vault */
export function createEnvelopeKeyProviderFromEnv(): EnvelopeKeyProvider {
  const kind = (process.env.ARES_ENVELOPE_PROVIDER ?? "env").toLowerCase();
  if (kind === "aws-kms") return new AwsKmsKeyProvider(process.env.ARES_KMS_KEY_ID ?? "");
  if (kind === "vault") {
    return new VaultTransitKeyProvider(process.env.ARES_VAULT_MOUNT ?? "transit", process.env.ARES_VAULT_KEY ?? "ares-envelope");
  }
  return new EnvKeyProvider();
}
