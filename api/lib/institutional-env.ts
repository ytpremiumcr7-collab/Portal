/**
 * Production institutional gates. Defaults keep existing portals runnable.
 * Never silently label SESSION as FIEL.
 */
function flag(name: string, productionDefault = false): boolean {
  const raw = process.env[name];
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return productionDefault && process.env.NODE_ENV === "production";
}

export const institutionalEnv = {
  evidenceSchemaVersion: Number(process.env.ARES_EVIDENCE_SCHEMA_VERSION ?? 2) >= 2 ? 2 : 1,
  requireCryptoFirma: flag("ARES_REQUIRE_CRYPTO_FIRMA", false),
  requireStepUp: flag("ARES_REQUIRE_STEP_UP", false),
  stepUpMinutes: Math.max(2, Number(process.env.ARES_STEP_UP_MINUTES ?? 15) || 15),
  aperturaSodStrict: flag("ARES_APERTURA_SOD_STRICT", false),
  tsaUrl: process.env.ARES_TSA_URL?.trim() || "",
  objectStoreBackend: (process.env.ARES_OBJECT_STORE || "filesystem").toLowerCase(),
  s3Bucket: process.env.ARES_S3_BUCKET?.trim() || "",
  s3Region: process.env.ARES_S3_REGION?.trim() || "us-east-1",
  s3Prefix: process.env.ARES_S3_PREFIX?.trim() || "ares",
  s3ObjectLock: flag("ARES_S3_OBJECT_LOCK", false),
};

export function cryptoRequiredForAct(): boolean {
  return institutionalEnv.requireCryptoFirma;
}
