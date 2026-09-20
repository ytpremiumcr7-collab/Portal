/**
 * Honest electronic signature architecture for Piedra Angular (ARES).
 *
 * SESSION_CONFIRMATION — authenticated session + timestamp + content hash.
 *   Default for non-juridical confirmations. MUST NOT be labeled "e.firma" or "FIEL".
 *
 * CRYPTO_SIGNATURE — CMS/.p7m with SAT-issued certificate, OCSP status.
 *   CompraNet / LAASSP advanced signature pattern. Requires .cer + .key + password
 *   → PKCS#7/CMS and (when configured) live SAT OCSP. Never claim CRYPTO without success.
 */

export type SignatureKind = "SESSION_CONFIRMATION" | "CRYPTO_SIGNATURE";

export type SignatureStatus =
  | "PENDING"
  | "VALID"
  | "INVALID"
  | "NOT_APPLICABLE"
  | "NOT_CONFIGURED";

/** FIEL materials — never log password or private key. */
export type CryptoMaterials = {
  /** .cer contents: DER Buffer, PEM string, or base64 DER/PEM. */
  cer: Buffer | string;
  /** Encrypted .key (PKCS#8 DER) Buffer / PEM / base64. */
  key: Buffer | string;
  password: string;
  /** Optional raw document bytes; otherwise SHA-256 of canonical payload JSON. */
  documentBytes?: Buffer;
  /** Pre-built CMS/.p7m (base64) for verify-only or attach-and-verify. */
  p7mBase64?: string;
};

export type SignInput = {
  tenantId: number;
  signerUserId: number;
  /** Canonical payload whose digest is attested. */
  payload: unknown;
  motivo?: string | null;
  /** Required when kind=CRYPTO_SIGNATURE. */
  crypto?: CryptoMaterials;
};

export type SignResult = {
  kind: SignatureKind;
  documentDigest: string;
  algorithm: string;
  /** Base64 CMS/.p7m for CRYPTO; null for SESSION. */
  signatureValue: string | null;
  certificatePem: string | null;
  certSerial: string | null;
  signerRfc: string | null;
  /** JSON snapshot of OCSP evidence when performed. */
  ocspEvidence: string | null;
  validationStatus: SignatureStatus;
  signedAt: Date;
  providerName: string;
};

export type VerifyInput = {
  kind: SignatureKind;
  documentDigest: string;
  signatureValue: string | null;
  certificatePem: string | null;
  payload?: unknown;
  /** Optional: skip OCSP even if env enables it. */
  skipOcsp?: boolean;
};

export type VerifyResult = {
  ok: boolean;
  status: SignatureStatus;
  detail: string;
  certSerial?: string | null;
  signerRfc?: string | null;
  ocspEvidence?: string | null;
};

export interface ElectronicSignatureProvider {
  readonly name: string;
  readonly kind: SignatureKind;
  /** True when CAs present and provider can attempt CRYPTO. */
  isConfigured(): boolean;
  sign(input: SignInput): Promise<SignResult>;
  verify(record: VerifyInput): Promise<VerifyResult>;
}
