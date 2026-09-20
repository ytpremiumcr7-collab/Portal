/**
 * Honest electronic signature architecture for Piedra Angular (ARES).
 *
 * SESSION_CONFIRMATION — authenticated session + timestamp + content hash.
 *   What production uses TODAY. MUST NOT be labeled "e.firma" or "FIEL".
 *
 * CRYPTO_SIGNATURE — CMS/.p7m with SAT-issued certificate, OCSP/CRL status.
 *   CompraNet / LAASSP advanced signature pattern. Requires .cer + .key + password
 *   → PKCS#7/CMS and live SAT certificate status. NOT configured in this build.
 */

export type SignatureKind = "SESSION_CONFIRMATION" | "CRYPTO_SIGNATURE";

export type SignatureStatus =
  | "PENDING"
  | "VALID"
  | "INVALID"
  | "NOT_APPLICABLE"
  | "NOT_CONFIGURED";

export type SignInput = {
  tenantId: number;
  signerUserId: number;
  /** Canonical payload whose digest is attested. */
  payload: unknown;
  motivo?: string | null;
};

export type SignResult = {
  kind: SignatureKind;
  documentDigest: string;
  algorithm: string;
  signatureValue: string | null;
  certificatePem: string | null;
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
};

export type VerifyResult = {
  ok: boolean;
  status: SignatureStatus;
  detail: string;
};

export interface ElectronicSignatureProvider {
  readonly name: string;
  readonly kind: SignatureKind;
  sign(input: SignInput): Promise<SignResult>;
  verify(record: VerifyInput): Promise<VerifyResult>;
}
