import type {
  ElectronicSignatureProvider,
  SignInput,
  SignResult,
  VerifyInput,
  VerifyResult,
} from "./electronic-signature-provider";

/**
 * Future SAT e.firma / FIEL provider (CompraNet pattern).
 *
 * Production FIEL requires:
 * 1. Contributor .cer (X.509) + .key (encrypted private key) + password
 * 2. Build CMS / PKCS#7 (.p7m) detached or attached signature over document digest
 * 3. Verify certificate chain + SAT OCSP/CRL status (not revoked / not expired)
 * 4. Store signatureKind = CRYPTO_SIGNATURE with certificate PEM and CMS blob
 *
 * This stub MUST throw / return NOT_CONFIGURED — never fake FIEL validation.
 */
export class SatEFirmaProvider implements ElectronicSignatureProvider {
  readonly name = "SatEFirmaProvider";
  readonly kind = "CRYPTO_SIGNATURE" as const;

  async sign(_input: SignInput): Promise<SignResult> {
    throw new Error(
      "SatEFirmaProvider UNIMPLEMENTED / NOT_CONFIGURED: production FIEL needs .cer+.key+password → .p7m CMS and SAT OCSP/CRL status check (CompraNet pattern). Do not claim CRYPTO_SIGNATURE without a real provider.",
    );
  }

  async verify(_record: VerifyInput): Promise<VerifyResult> {
    return {
      ok: false,
      status: "NOT_CONFIGURED",
      detail:
        "SatEFirmaProvider NOT_CONFIGURED: FIEL/.p7m + SAT OCSP/CRL verification is not wired in this build.",
    };
  }
}
