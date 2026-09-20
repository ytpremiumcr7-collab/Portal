import { createHash } from "node:crypto";
import type {
  ElectronicSignatureProvider,
  SignInput,
  SignResult,
  VerifyInput,
  VerifyResult,
} from "./electronic-signature-provider";

function digestPayload(payload: unknown): string {
  return createHash("sha256")
    .update(typeof payload === "string" ? payload : JSON.stringify(payload))
    .digest("hex");
}

/**
 * Default production provider: records authenticated user + timestamp + content hash.
 * Honest label: SESSION_CONFIRMATION — never claim e.firma / FIEL.
 */
export class SessionConfirmationProvider implements ElectronicSignatureProvider {
  readonly name = "SessionConfirmationProvider";
  readonly kind = "SESSION_CONFIRMATION" as const;

  async sign(input: SignInput): Promise<SignResult> {
    return {
      kind: "SESSION_CONFIRMATION",
      documentDigest: digestPayload(input.payload),
      algorithm: "SHA256",
      signatureValue: null,
      certificatePem: null,
      validationStatus: "NOT_APPLICABLE",
      signedAt: new Date(),
      providerName: this.name,
    };
  }

  async verify(record: VerifyInput): Promise<VerifyResult> {
    if (record.kind !== "SESSION_CONFIRMATION") {
      return { ok: false, status: "INVALID", detail: "Kind mismatch for SessionConfirmationProvider." };
    }
    if (!/^[a-f0-9]{64}$/.test(record.documentDigest)) {
      return { ok: false, status: "INVALID", detail: "documentDigest must be sha256 hex." };
    }
    if (record.payload !== undefined) {
      const expected = digestPayload(record.payload);
      if (expected !== record.documentDigest) {
        return { ok: false, status: "INVALID", detail: "Payload digest does not match stored documentDigest." };
      }
    }
    return {
      ok: true,
      status: "NOT_APPLICABLE",
      detail: "Session confirmation attested; no cryptographic certificate to validate.",
    };
  }
}
