export type {
  ElectronicSignatureProvider,
  SignatureKind,
  SignatureStatus,
  SignInput,
  SignResult,
  VerifyInput,
  VerifyResult,
} from "./electronic-signature-provider";
export { SessionConfirmationProvider } from "./session-confirmation-provider";
export { SatEFirmaProvider } from "./sat-efirma-provider";

import type { ElectronicSignatureProvider, SignatureKind } from "./electronic-signature-provider";
import { SessionConfirmationProvider } from "./session-confirmation-provider";
import { SatEFirmaProvider } from "./sat-efirma-provider";

const sessionProvider = new SessionConfirmationProvider();
const satProvider = new SatEFirmaProvider();

/** Resolve provider by declared kind. CRYPTO always goes to SatEFirma (stub). */
export function getSignatureProvider(kind: SignatureKind = "SESSION_CONFIRMATION"): ElectronicSignatureProvider {
  if (kind === "CRYPTO_SIGNATURE") return satProvider;
  return sessionProvider;
}

export function labelForSignatureKind(kind: SignatureKind): string {
  if (kind === "CRYPTO_SIGNATURE") return "Firma criptográfica (e.firma/FIEL — requiere proveedor SAT)";
  return "Confirmación de sesión autenticada (no es e.firma ni FIEL)";
}
