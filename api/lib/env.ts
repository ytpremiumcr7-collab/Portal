import "dotenv/config";

/** First non-empty env among aliases. Prefer PA_* / PIEDRA_*; ARES_* remains accepted. */
export function envFirst(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value != null && String(value).trim() !== "") return String(value);
  }
  return undefined;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

/**
 * Public org self-serve register:
 * - production: disabled unless PA_ALLOW_PUBLIC_REGISTER / ARES_ALLOW_PUBLIC_REGISTER=true
 * - development: allowed unless the flag is explicitly false
 * Default production flag is false (anti-demo / no open tenant minting).
 */
function allowPublicRegister(): boolean {
  const raw = envFirst("PA_ALLOW_PUBLIC_REGISTER", "PIEDRA_ALLOW_PUBLIC_REGISTER", "ARES_ALLOW_PUBLIC_REGISTER");
  if (process.env.NODE_ENV === "production") {
    return raw === "true";
  }
  if (raw === "false") return false;
  return true;
}

export const env = {
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  storagePath: envFirst("PA_STORAGE_PATH", "PIEDRA_STORAGE_PATH", "ARES_STORAGE_PATH") || "./storage",
  allowPublicRegister: allowPublicRegister(),
  trustProxy: ["true", "1"].includes(
    (envFirst("PA_TRUST_PROXY", "PIEDRA_TRUST_PROXY", "ARES_TRUST_PROXY") || "").toLowerCase(),
  ),
};

/** e.firma / FIEL OCSP — see api/lib/firma/sat-cas/README.md */
export const efirmaEnv = {
  ocspEnabled: (() => {
    const raw = process.env.PA_EFIRMA_OCSP;
    if (raw === "0" || raw === "false") return false;
    if (raw === "1" || raw === "true") return true;
    return process.env.NODE_ENV === "production";
  })(),
  ocspFailOpen: process.env.PA_EFIRMA_OCSP_FAIL_OPEN === "1" || process.env.PA_EFIRMA_OCSP_FAIL_OPEN === "true",
  satCasDir: process.env.PA_EFIRMA_SAT_CAS_DIR || "",
};
