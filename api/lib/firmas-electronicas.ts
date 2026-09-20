import { firmasElectronicas } from "@db/schema";
import {
  getSignatureProvider,
  labelForSignatureKind,
  type SignatureKind,
} from "./firma";
import { createHash } from "node:crypto";

export type FirmaKind = SignatureKind;
export { labelForSignatureKind };

/**
 * Honest e-signature base:
 * - SESSION_CONFIRMATION: authenticated session attested digest (NOT advanced e.firma / FIEL).
 * - CRYPTO_SIGNATURE: reserved for SatEFirmaProvider (.cer/.key/.p7m + SAT OCSP/CRL) — NOT_CONFIGURED.
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
}) {
  const provider = getSignatureProvider(input.kind);
  // CRYPTO_SIGNATURE routes to SatEFirmaProvider which throws NOT_CONFIGURED — never fake FIEL.
  const signed = await provider.sign({
    tenantId: input.tenantId,
    signerUserId: input.signerUserId,
    payload: input.payload,
    motivo: input.motivo,
  });

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
    signerUserId: input.signerUserId,
    signedAt: signed.signedAt,
    validationStatus: signed.validationStatus === "NOT_CONFIGURED" ? "PENDING" : signed.validationStatus,
    motivo: input.motivo ?? null,
  } as any);
  return {
    id: Number(result[0].insertId),
    documentDigest: signed.documentDigest,
    kind: input.kind,
    algorithm: signed.algorithm,
    validationStatus: signed.validationStatus,
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
