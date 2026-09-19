import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { firmasElectronicas } from "@db/schema";

export type FirmaKind = "SESSION_CONFIRMATION" | "CRYPTO_SIGNATURE";

/**
 * Honest e-signature base:
 * - SESSION_CONFIRMATION: authenticated session attested digest (NOT advanced e.firma).
 * - CRYPTO_SIGNATURE: Node crypto sign with tenant/dev key — structure ready for qualified provider.
 * Do not label either as "e.firma avanzada / FIEL".
 */
export function digestPayload(payload: unknown): string {
  return createHash("sha256").update(typeof payload === "string" ? payload : JSON.stringify(payload)).digest("hex");
}

let devKey: { privateKey: string; publicKey: string } | null = null;
function getDevKey() {
  if (process.env.ARES_SIGNING_PRIVATE_KEY_PEM) {
    return { privateKey: process.env.ARES_SIGNING_PRIVATE_KEY_PEM, publicKey: process.env.ARES_SIGNING_PUBLIC_KEY_PEM ?? "" };
  }
  if (!devKey) {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    devKey = { privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKey: publicKey.export({ type: "spki", format: "pem" }).toString() };
  }
  return devKey;
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
  const documentDigest = digestPayload(input.payload);
  let signatureValue: string | null = null;
  let certificatePem: string | null = null;
  let validationStatus: "PENDING" | "VALID" | "INVALID" | "NOT_APPLICABLE" = "NOT_APPLICABLE";
  let algorithm = "SHA256";

  if (input.kind === "CRYPTO_SIGNATURE") {
    const key = getDevKey();
    const signer = createSign("RSA-SHA256");
    signer.update(documentDigest);
    signer.end();
    signatureValue = signer.sign(key.privateKey, "base64");
    certificatePem = key.publicKey || null;
    validationStatus = "VALID";
    algorithm = "RSA-SHA256";
  }

  const result = await tx.insert(firmasElectronicas).values({
    tenantId: input.tenantId,
    documentoId: input.documentoId ?? null,
    entidadRef: input.entidadRef,
    entidadId: input.entidadId,
    kind: input.kind,
    documentDigest,
    algorithm,
    signatureValue,
    certificatePem,
    signerUserId: input.signerUserId,
    signedAt: new Date(),
    validationStatus,
    motivo: input.motivo ?? null,
  } as any);
  return { id: Number(result[0].insertId), documentDigest, kind: input.kind, algorithm, validationStatus };
}
