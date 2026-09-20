/**
 * Load SAT AC4/AC5 issuer + OCSP signer certificates from disk.
 * Source documented in ./sat-cas/README.md — never ship contributor FIEL secrets.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Certificate } from "@cfdi/csd";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type SatCasBundle = {
  issuers: Certificate[];
  ocspSigners: Certificate[];
  dir: string;
  configured: boolean;
  missing: string[];
};

function defaultCasDir(): string {
  return process.env.PA_EFIRMA_SAT_CAS_DIR?.trim() || join(__dirname, "sat-cas");
}

function tryLoadCert(path: string): Certificate | null {
  try {
    const buf = readFileSync(path);
    const text = buf.toString("utf8");
    if (text.includes("BEGIN CERTIFICATE")) return Certificate.fromPem(text);
    return Certificate.fromDer(buf);
  } catch {
    return null;
  }
}

/** Match AC4/AC5 issuers and OCSP signer certs by filename convention. */
export function loadSatCasBundle(dir = defaultCasDir()): SatCasBundle {
  const missing: string[] = [];
  const issuers: Certificate[] = [];
  const ocspSigners: Certificate[] = [];

  if (!existsSync(dir)) {
    return {
      issuers: [],
      ocspSigners: [],
      dir,
      configured: false,
      missing: ["directory missing — see api/lib/firma/sat-cas/README.md"],
    };
  }

  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /\.(cer|crt|pem)$/i.test(f));
  } catch {
    return { issuers: [], ocspSigners: [], dir, configured: false, missing: ["unreadable sat-cas dir"] };
  }

  for (const name of files) {
    const cert = tryLoadCert(join(dir, name));
    if (!cert) continue;
    const upper = name.toUpperCase();
    if (upper.includes("OCSP")) {
      ocspSigners.push(cert);
    } else if (upper.includes("AC4") || upper.includes("AC5") || upper.includes("AC_")) {
      issuers.push(cert);
    } else if (upper.includes("SAT") || upper.includes("AUTORIDAD")) {
      issuers.push(cert);
    }
  }

  if (!issuers.length) missing.push("AC4/AC5 issuer .cer/.pem");
  if (!ocspSigners.length) missing.push("OCSP signer .cer/.pem (OCSP_AC4 / OCSP_AC5)");

  // OCSP signer optional when PA_EFIRMA_OCSP=0 — still need issuers for chain honesty.
  const ocspEnabled = isOcspEnabled();
  const configured = issuers.length > 0 && (!ocspEnabled || ocspSigners.length > 0);

  return { issuers, ocspSigners, dir, configured, missing };
}

export function isOcspEnabled(): boolean {
  const raw = process.env.PA_EFIRMA_OCSP;
  if (raw === "0" || raw === "false") return false;
  if (raw === "1" || raw === "true") return true;
  return process.env.NODE_ENV === "production";
}

/** Fail-closed by default when OCSP unreachable for CRYPTO acts. */
export function isOcspFailOpen(): boolean {
  return process.env.PA_EFIRMA_OCSP_FAIL_OPEN === "1" || process.env.PA_EFIRMA_OCSP_FAIL_OPEN === "true";
}

export const SAT_OCSP_URL = "https://cfdi.sat.gob.mx/edofiel";

/** Pick issuer that signed subject (AC4 or AC5). */
export function findIssuerFor(subject: Certificate, issuers: Certificate[]): Certificate | null {
  for (const iss of issuers) {
    try {
      if (subject.verifyIssuedBy(iss) || subject.verifyIntegrity(iss)) return iss;
    } catch {
      /* try next */
    }
  }
  // Fallback: match by subject CN / serial heuristics via acVersion
  const ver = subject.acVersion?.() ?? null;
  if (ver === 4) {
    const ac4 = issuers.find((c) => {
      try {
        const subj = c.subject?.() ?? {};
        return JSON.stringify(subj).includes("AC 4") || JSON.stringify(subj).includes("AC4");
      } catch {
        return false;
      }
    });
    if (ac4) return ac4;
  }
  if (ver === 5) {
    const ac5 = issuers.find((c) => {
      try {
        const subj = c.subject?.() ?? {};
        return JSON.stringify(subj).includes("AC 5") || JSON.stringify(subj).includes("AC5");
      } catch {
        return false;
      }
    });
    if (ac5) return ac5;
  }
  return issuers[0] ?? null;
}

export function pickOcspSigner(issuer: Certificate, signers: Certificate[]): Certificate {
  if (!signers.length) throw new Error("No OCSP signer certificates loaded.");
  // Prefer signer whose issuer matches; else first.
  for (const s of signers) {
    try {
      if (s.verifyIssuedBy(issuer)) return s;
    } catch {
      /* continue */
    }
  }
  return signers[0];
}
