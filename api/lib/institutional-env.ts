import { envFirst } from "./env";

/**
 * Production institutional gates. Defaults keep existing portals runnable.
 * Never silently label SESSION as FIEL.
 * Flags accept PA_* / PIEDRA_* first; ARES_* remains an alias.
 */
function flag(...names: string[]): boolean {
  const raw = envFirst(...names);
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return false;
}

export const institutionalEnv = {
  evidenceSchemaVersion: Number(envFirst("PA_EVIDENCE_SCHEMA_VERSION", "ARES_EVIDENCE_SCHEMA_VERSION") ?? 2) >= 2 ? 2 : 1,
  requireCryptoFirma: flag("PA_REQUIRE_CRYPTO_FIRMA", "ARES_REQUIRE_CRYPTO_FIRMA"),
  requireStepUp: flag("PA_REQUIRE_STEP_UP", "ARES_REQUIRE_STEP_UP"),
  stepUpMinutes: Math.max(2, Number(envFirst("PA_STEP_UP_MINUTES", "ARES_STEP_UP_MINUTES") ?? 15) || 15),
  aperturaSodStrict: flag("PA_APERTURA_SOD_STRICT", "ARES_APERTURA_SOD_STRICT"),
  tsaUrl: envFirst("PA_TSA_URL", "ARES_TSA_URL")?.trim() || "",
  objectStoreBackend: (envFirst("PA_OBJECT_STORE", "ARES_OBJECT_STORE") || "filesystem").toLowerCase(),
  s3Bucket: envFirst("PA_S3_BUCKET", "ARES_S3_BUCKET")?.trim() || "",
  s3Region: envFirst("PA_S3_REGION", "ARES_S3_REGION")?.trim() || "us-east-1",
  s3Prefix: envFirst("PA_S3_PREFIX", "ARES_S3_PREFIX")?.trim() || "piedra-angular",
  s3ObjectLock: flag("PA_S3_OBJECT_LOCK", "ARES_S3_OBJECT_LOCK"),
};

export function cryptoRequiredForAct(): boolean {
  return institutionalEnv.requireCryptoFirma;
}
