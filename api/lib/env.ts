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
