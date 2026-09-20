import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

/**
 * Public org self-serve register:
 * - production: disabled unless ARES_ALLOW_PUBLIC_REGISTER=true
 * - development: allowed unless ARES_ALLOW_PUBLIC_REGISTER=false
 * Default production flag is false (anti-demo / no open tenant minting).
 */
function allowPublicRegister(): boolean {
  const raw = process.env.ARES_ALLOW_PUBLIC_REGISTER;
  if (process.env.NODE_ENV === "production") {
    return raw === "true";
  }
  if (raw === "false") return false;
  return true;
}

export const env = {
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  storagePath: process.env.ARES_STORAGE_PATH || "./storage",
  allowPublicRegister: allowPublicRegister(),
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
