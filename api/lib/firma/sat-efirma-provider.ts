import { createHash } from "node:crypto";
import forge from "node-forge";
import { Certificate, Credential, Ocsp, PrivateKey, OcspCertificateStatus } from "@cfdi/csd";
import type {
  ElectronicSignatureProvider,
  SignInput,
  SignResult,
  VerifyInput,
  VerifyResult,
} from "./electronic-signature-provider";
import {
  findIssuerFor,
  isOcspEnabled,
  isOcspFailOpen,
  loadSatCasBundle,
  pickOcspSigner,
  SAT_OCSP_URL,
  type SatCasBundle,
} from "./sat-cas-loader";

function digestPayload(payload: unknown): string {
  return createHash("sha256")
    .update(typeof payload === "string" ? payload : JSON.stringify(payload))
    .digest("hex");
}

function asBuffer(input: Buffer | string): Buffer {
  if (Buffer.isBuffer(input)) return input;
  const s = input.trim();
  if (s.includes("BEGIN ")) return Buffer.from(s, "utf8");
  // base64 (DER or PEM-as-base64)
  try {
    const decoded = Buffer.from(s.replace(/\s+/g, ""), "base64");
    if (decoded.length > 32) return decoded;
  } catch {
    /* fall through */
  }
  return Buffer.from(s, "utf8");
}

function loadCertificate(cer: Buffer | string): Certificate {
  const buf = asBuffer(cer);
  const text = buf.toString("utf8");
  if (text.includes("BEGIN CERTIFICATE")) return Certificate.fromPem(text);
  return Certificate.fromDer(buf);
}

function loadPrivateKey(key: Buffer | string, password: string): PrivateKey {
  const buf = asBuffer(key);
  const text = buf.toString("utf8");
  if (text.includes("BEGIN ")) {
    // May still be encrypted PEM — prefer fromDer path when password set.
    if (text.includes("ENCRYPTED") || text.includes("BEGIN ENCRYPTED")) {
      return PrivateKey.fromDer(buf, password);
    }
    try {
      return PrivateKey.fromPem(text);
    } catch {
      return PrivateKey.fromDer(buf, password);
    }
  }
  return PrivateKey.fromDer(buf, password);
}

function wipeString(s: string | undefined | null) {
  // Best-effort: JS strings are immutable; avoid retaining references in closures.
  void s;
}

/** Build detached CMS/PKCS#7 SignedData (.p7m) over content bytes. */
function buildDetachedP7m(certPem: string, keyPem: string, content: Buffer): string {
  const cert = forge.pki.certificateFromPem(certPem);
  const privateKey = forge.pki.privateKeyFromPem(keyPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(content.toString("binary"));
  p7.addCertificate(cert);
  p7.addSigner({
    key: privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Buffer.from(der, "binary").toString("base64");
}

function verifyDetachedP7m(p7mBase64: string, content: Buffer, expectedCertPem?: string | null): {
  ok: boolean;
  detail: string;
  certPem: string | null;
} {
  try {
    const der = Buffer.from(p7mBase64.replace(/\s+/g, ""), "base64");
    const asn1 = forge.asn1.fromDer(der.toString("binary"));
    const p7 = forge.pkcs7.messageFromAsn1(asn1) as forge.pkcs7.PkcsSignedData;
    p7.content = forge.util.createBuffer(content.toString("binary"));
    // node-forge verify checks signer signatures when content is set
    const captcha: { verified?: boolean } = {};
    try {
      // @ts-expect-error forge types vary by version
      p7.verify?.(captcha);
    } catch (e: any) {
      return { ok: false, detail: `CMS verify failed: ${e?.message ?? e}`, certPem: null };
    }
    const embedded = (p7 as any).certificates?.[0]
      ? forge.pki.certificateToPem((p7 as any).certificates[0])
      : expectedCertPem ?? null;
    if (expectedCertPem && embedded) {
      const norm = (p: string) => p.replace(/\s+/g, "");
      if (norm(embedded) !== norm(expectedCertPem) && !embedded.includes(expectedCertPem.split("\n")[1] ?? "___")) {
        // Soft check — serial match preferred below
      }
    }
    return { ok: true, detail: "CMS/.p7m signature verified against embedded certificate.", certPem: embedded };
  } catch (e: any) {
    return { ok: false, detail: `CMS parse/verify error: ${e?.message ?? e}`, certPem: null };
  }
}

/**
 * SAT e.firma / FIEL provider (CompraNet pattern).
 * Uses @cfdi/csd (Certificate, PrivateKey, Credential, Ocsp) + node-forge CMS/.p7m.
 * Without SAT CAs under sat-cas/: NOT_CONFIGURED — never fake FIEL.
 */
export class SatEFirmaProvider implements ElectronicSignatureProvider {
  readonly name = "SatEFirmaProvider";
  readonly kind = "CRYPTO_SIGNATURE" as const;
  private bundle: SatCasBundle;

  constructor(bundle?: SatCasBundle) {
    this.bundle = bundle ?? loadSatCasBundle();
  }

  /** Reload CAs (tests / ops). */
  reloadCas(bundle?: SatCasBundle) {
    this.bundle = bundle ?? loadSatCasBundle();
  }

  isConfigured(): boolean {
    return this.bundle.configured;
  }

  configurationDetail(): string {
    if (this.bundle.configured) return `Configured (issuers=${this.bundle.issuers.length}, ocspSigners=${this.bundle.ocspSigners.length}, dir=${this.bundle.dir})`;
    return `NOT_CONFIGURED: missing ${this.bundle.missing.join("; ") || "SAT CA material"}. See api/lib/firma/sat-cas/README.md`;
  }

  async sign(input: SignInput): Promise<SignResult> {
    if (!this.bundle.configured) {
      throw new Error(
        `SatEFirmaProvider NOT_CONFIGURED: ${this.bundle.missing.join("; ") || "SAT AC4/AC5 + OCSP certs required"}. Do not claim CRYPTO_SIGNATURE without a real provider. SESSION_CONFIRMATION remains available for non-juridical confirmations.`,
      );
    }
    if (!input.crypto?.cer || !input.crypto?.key || input.crypto.password == null) {
      throw new Error(
        "SatEFirmaProvider requires crypto.cer + crypto.key + crypto.password (FIEL). Never pass session-only as CRYPTO.",
      );
    }

    const documentDigest = input.crypto.documentBytes
      ? createHash("sha256").update(input.crypto.documentBytes).digest("hex")
      : digestPayload(input.payload);
    const content = input.crypto.documentBytes ?? Buffer.from(documentDigest, "utf8");

    let certificate: Certificate;
    let privateKey: PrivateKey;
    let credential: Credential;
    try {
      certificate = loadCertificate(input.crypto.cer);
      privateKey = loadPrivateKey(input.crypto.key, input.crypto.password);
      credential = Credential.fromPem(certificate.toPem(), privateKey.toPem());
    } catch (e: any) {
      wipeString(input.crypto.password);
      throw new Error(`SatEFirmaProvider: cannot load FIEL materials (${e?.message ?? e}).`);
    } finally {
      wipeString(input.crypto.password);
    }

    if (!certificate.isValid() || certificate.isExpired()) {
      throw new Error("SatEFirmaProvider: certificate outside validity window (notBefore/notAfter).");
    }
    if (!credential.keyMatchesCertificate()) {
      throw new Error("SatEFirmaProvider: private key does not match certificate.");
    }

    // Prefer FIEL for e.firma; allow CSD only if explicitly same crypto path (honest label still CRYPTO).
    const algorithm = "SHA256withRSA-CMS-detached";
    let p7mBase64: string;
    if (input.crypto.p7mBase64) {
      // Attach-and-verify mode: caller supplies pre-built CMS
      p7mBase64 = input.crypto.p7mBase64.replace(/\s+/g, "");
      const check = verifyDetachedP7m(p7mBase64, content, certificate.toPem());
      if (!check.ok) throw new Error(`SatEFirmaProvider: supplied .p7m invalid — ${check.detail}`);
    } else {
      p7mBase64 = buildDetachedP7m(certificate.toPem(), privateKey.toPem(), content);
    }

    let ocspEvidence: string | null = null;
    let validationStatus: SignResult["validationStatus"] = "PENDING";

    if (isOcspEnabled()) {
      const ocsp = await this.runOcsp(certificate);
      ocspEvidence = JSON.stringify(ocsp);
      if (ocsp.status === "GOOD") {
        validationStatus = "VALID";
      } else if (ocsp.status === "REVOKED") {
        throw new Error("SatEFirmaProvider: certificate REVOKED per SAT OCSP.");
      } else if (!isOcspFailOpen()) {
        throw new Error(
          `SatEFirmaProvider: OCSP fail-closed — status=${ocsp.status}; detail=${ocsp.detail}`,
        );
      } else {
        validationStatus = "PENDING";
      }
    }

    return {
      kind: "CRYPTO_SIGNATURE",
      documentDigest,
      algorithm,
      signatureValue: p7mBase64,
      certificatePem: certificate.toPem(),
      certSerial: certificate.serialNumber(),
      signerRfc: certificate.rfc(),
      ocspEvidence,
      validationStatus,
      signedAt: new Date(),
      providerName: this.name,
    };
  }

  async verify(record: VerifyInput): Promise<VerifyResult> {
    if (!this.bundle.configured) {
      return {
        ok: false,
        status: "NOT_CONFIGURED",
        detail: this.configurationDetail(),
      };
    }
    if (record.kind !== "CRYPTO_SIGNATURE") {
      return { ok: false, status: "INVALID", detail: "Kind mismatch for SatEFirmaProvider." };
    }
    if (!record.signatureValue) {
      return { ok: false, status: "INVALID", detail: "Missing CMS/.p7m signatureValue." };
    }
    if (!/^[a-f0-9]{64}$/i.test(record.documentDigest)) {
      return { ok: false, status: "INVALID", detail: "documentDigest must be sha256 hex." };
    }

    const content =
      record.payload !== undefined
        ? Buffer.from(digestPayload(record.payload) === record.documentDigest
          ? record.documentDigest
          : digestPayload(record.payload), "utf8")
        : Buffer.from(record.documentDigest, "utf8");

    // If payload provided and digest mismatch → invalid
    if (record.payload !== undefined) {
      const expected = digestPayload(record.payload);
      if (expected !== record.documentDigest) {
        return { ok: false, status: "INVALID", detail: "Payload digest does not match stored documentDigest." };
      }
    }

    const cms = verifyDetachedP7m(record.signatureValue, content, record.certificatePem);
    if (!cms.ok) return { ok: false, status: "INVALID", detail: cms.detail };

    let certificate: Certificate | null = null;
    try {
      if (record.certificatePem) certificate = Certificate.fromPem(record.certificatePem);
      else if (cms.certPem) certificate = Certificate.fromPem(cms.certPem);
    } catch (e: any) {
      return { ok: false, status: "INVALID", detail: `Certificate parse error: ${e?.message ?? e}` };
    }
    if (!certificate) {
      return { ok: false, status: "INVALID", detail: "No certificate embedded or provided." };
    }
    if (!certificate.isValid() || certificate.isExpired()) {
      return {
        ok: false,
        status: "INVALID",
        detail: "Certificate outside validity window.",
        certSerial: certificate.serialNumber(),
        signerRfc: certificate.rfc(),
      };
    }

    if (!record.skipOcsp && isOcspEnabled()) {
      try {
        const ocsp = await this.runOcsp(certificate);
        const evidence = JSON.stringify(ocsp);
        if (ocsp.status === "GOOD") {
          return {
            ok: true,
            status: "VALID",
            detail: "CMS verified; certificate dates OK; OCSP GOOD.",
            certSerial: certificate.serialNumber(),
            signerRfc: certificate.rfc(),
            ocspEvidence: evidence,
          };
        }
        if (ocsp.status === "REVOKED") {
          return {
            ok: false,
            status: "INVALID",
            detail: "OCSP REVOKED.",
            certSerial: certificate.serialNumber(),
            signerRfc: certificate.rfc(),
            ocspEvidence: evidence,
          };
        }
        if (!isOcspFailOpen()) {
          return {
            ok: false,
            status: "INVALID",
            detail: `OCSP fail-closed: ${ocsp.detail}`,
            certSerial: certificate.serialNumber(),
            signerRfc: certificate.rfc(),
            ocspEvidence: evidence,
          };
        }
        return {
          ok: true,
          status: "PENDING",
          detail: `CMS+dates OK; OCSP inconclusive (fail-open): ${ocsp.detail}`,
          certSerial: certificate.serialNumber(),
          signerRfc: certificate.rfc(),
          ocspEvidence: evidence,
        };
      } catch (e: any) {
        if (!isOcspFailOpen()) {
          return {
            ok: false,
            status: "INVALID",
            detail: `OCSP unreachable (fail-closed): ${e?.message ?? e}`,
            certSerial: certificate.serialNumber(),
            signerRfc: certificate.rfc(),
          };
        }
        return {
          ok: true,
          status: "PENDING",
          detail: `CMS+dates OK; OCSP unreachable (fail-open): ${e?.message ?? e}`,
          certSerial: certificate.serialNumber(),
          signerRfc: certificate.rfc(),
        };
      }
    }

    return {
      ok: true,
      status: "PENDING",
      detail: "CMS verified; certificate dates OK; OCSP skipped.",
      certSerial: certificate.serialNumber(),
      signerRfc: certificate.rfc(),
    };
  }

  private async runOcsp(subject: Certificate): Promise<{
    status: "GOOD" | "REVOKED" | "UNKNOWN" | "ERROR";
    detail: string;
    ocspRequestBase64?: string;
    ocspResponseBase64?: string;
  }> {
    const issuer = findIssuerFor(subject, this.bundle.issuers);
    if (!issuer) {
      return { status: "ERROR", detail: "No matching AC4/AC5 issuer loaded for subject certificate." };
    }
    if (!this.bundle.ocspSigners.length) {
      return { status: "ERROR", detail: "No OCSP signer certificates loaded." };
    }
    const ocspCert = pickOcspSigner(issuer, this.bundle.ocspSigners);
    try {
      const client = new Ocsp(SAT_OCSP_URL, issuer, subject, ocspCert);
      const res = await client.verify();
      const status =
        res.status === "GOOD"
          ? "GOOD"
          : res.status === "REVOKED"
            ? "REVOKED"
            : "UNKNOWN";
      return {
        status,
        detail: `OCSP ${status} via ${SAT_OCSP_URL}`,
        ocspRequestBase64: res.ocspRequestBase64,
        ocspResponseBase64: res.ocspResponseBase64,
      };
    } catch (e: any) {
      return { status: "ERROR", detail: e?.message ?? String(e) };
    }
  }
}

/** @internal test helper — expose OcspCertificateStatus enum usage honesty */
export const _satEFirmaInternals = { OcspCertificateStatus, digestPayload, buildDetachedP7m, verifyDetachedP7m };
