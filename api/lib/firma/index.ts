export type {
  ElectronicSignatureProvider,
  SignatureKind,
  SignatureStatus,
  SignInput,
  SignResult,
  VerifyInput,
  VerifyResult,
  CryptoMaterials,
} from "./electronic-signature-provider";
export { SessionConfirmationProvider } from "./session-confirmation-provider";
export { SatEFirmaProvider } from "./sat-efirma-provider";
export { loadSatCasBundle, isOcspEnabled, isOcspFailOpen, SAT_OCSP_URL } from "./sat-cas-loader";

import type { ElectronicSignatureProvider, SignatureKind } from "./electronic-signature-provider";
import { SessionConfirmationProvider } from "./session-confirmation-provider";
import { SatEFirmaProvider } from "./sat-efirma-provider";

const sessionProvider = new SessionConfirmationProvider();
const satProvider = new SatEFirmaProvider();

/** Resolve provider by declared kind. CRYPTO always goes to SatEFirma. */
export function getSignatureProvider(kind: SignatureKind = "SESSION_CONFIRMATION"): ElectronicSignatureProvider {
  if (kind === "CRYPTO_SIGNATURE") return satProvider;
  return sessionProvider;
}

export function labelForSignatureKind(kind: SignatureKind): string {
  if (kind === "CRYPTO_SIGNATURE") {
    return satProvider.isConfigured()
      ? "Firma criptográfica e.firma/FIEL (CMS/.p7m + OCSP SAT)"
      : "Firma criptográfica (e.firma/FIEL — SatEFirma NOT_CONFIGURED sin CAs SAT)";
  }
  return "Confirmación de sesión autenticada (no es e.firma ni FIEL)";
}

/** Reject SESSION when policy requires CRYPTO. */
export function assertCryptoKindWhenRequired(required: boolean, kind: SignatureKind) {
  if (required && kind !== "CRYPTO_SIGNATURE") {
    const err: any = new Error(
      "La ProcedurePolicy exige firma electrónica avanzada (CRYPTO_SIGNATURE / e.firma). SESSION_CONFIRMATION no es aceptable.",
    );
    err.code = "CRYPTO_REQUIRED";
    throw err;
  }
}
