import { firmasElectronicas } from "@db/schema";
import {
  assertCryptoKindWhenRequired,
  getSignatureProvider,
  labelForSignatureKind,
  type CryptoMaterials,
  type SignatureKind,
} from "./firma";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";

export type FirmaKind = SignatureKind;
export { labelForSignatureKind, assertCryptoKindWhenRequired };

/**
 * Honest e-signature base:
 * - SESSION_CONFIRMATION: authenticated session attested digest (NOT advanced e.firma / FIEL).
 * - CRYPTO_SIGNATURE: SatEFirmaProvider (.cer/.key/.p7m + SAT OCSP) when CAs configured.
 * Do not label SESSION_CONFIRMATION as "e.firma avanzada / FIEL".
 */
export function digestPayload(payload: unknown): string {
  return createHash("sha256").update(typeof payload === "string" ? payload : JSON.stringify(payload)).digest("hex");
}

export async function createFirmaElectronica(tx: any, input: {
  tenantId: number;
  documentoId?: number | null;
  entidadRef: string;
  entidadId: number;
  kind: FirmaKind;
  payload: unknown;
  signerUserId: number;
  motivo?: string | null;
  crypto?: CryptoMaterials;
  /** When true, SESSION_CONFIRMATION is rejected. */
  requireCrypto?: boolean;
}) {
  try {
    assertCryptoKindWhenRequired(!!input.requireCrypto, input.kind);
  } catch (e: any) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: e?.message ?? String(e) });
  }

  const provider = getSignatureProvider(input.kind);
  let signed;
  try {
    signed = await provider.sign({
      tenantId: input.tenantId,
      signerUserId: input.signerUserId,
      payload: input.payload,
      motivo: input.motivo,
      crypto: input.crypto,
    });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (/NOT_CONFIGURED/i.test(msg)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: msg });
    }
    throw new TRPCError({ code: "BAD_REQUEST", message: msg });
  }

  // Map NOT_CONFIGURED → should not persist as CRYPTO success
  const dbStatus =
    signed.validationStatus === "NOT_CONFIGURED"
      ? "PENDING"
      : signed.validationStatus === "VALID"
        ? "VALID"
        : signed.validationStatus === "INVALID"
          ? "INVALID"
          : signed.validationStatus === "NOT_APPLICABLE"
            ? "NOT_APPLICABLE"
            : "PENDING";

  const result = await tx.insert(firmasElectronicas).values({
    tenantId: input.tenantId,
    documentoId: input.documentoId ?? null,
    entidadRef: input.entidadRef,
    entidadId: input.entidadId,
    kind: input.kind,
    documentDigest: signed.documentDigest,
    algorithm: signed.algorithm,
    signatureValue: signed.signatureValue,
    certificatePem: signed.certificatePem,
    certSerial: signed.certSerial ?? null,
    signerRfc: signed.signerRfc ?? null,
    ocspEvidence: signed.ocspEvidence ?? null,
    signerUserId: input.signerUserId,
    signedAt: signed.signedAt,
    validationStatus: dbStatus,
    motivo: input.motivo ?? null,
  } as any);
  return {
    id: Number(result[0].insertId),
    documentDigest: signed.documentDigest,
    kind: input.kind,
    algorithm: signed.algorithm,
    validationStatus: signed.validationStatus,
    certSerial: signed.certSerial,
    signerRfc: signed.signerRfc,
    label: labelForSignatureKind(input.kind),
    providerName: signed.providerName,
  };
}

export async function verifyFirmaRecord(record: {
  kind: FirmaKind;
  documentDigest: string;
  signatureValue: string | null;
  certificatePem: string | null;
  payload?: unknown;
}) {
  return getSignatureProvider(record.kind).verify(record);
}

/** Policy / tenant flag helper. */
export function policyRequiresCryptoFirma(requisitos: unknown): boolean {
  if (!requisitos || typeof requisitos !== "object") return false;
  const r = requisitos as Record<string, unknown>;
  return r.requiereFirmaElectronicaAvanzada === true || r.requireCryptoSignature === true;
}
