# e.firma / FIEL — live E2E (external gate)

## What is in-repo vs external

| Layer | Status in Piedra Angular |
|-------|--------------------------|
| `SESSION_CONFIRMATION` | Implemented — authenticated session attestation. **Not** e.firma/FIEL. |
| `CRYPTO_SIGNATURE` path (`SatEFirmaProvider`) | Implemented — CMS/.p7m + SAT CA bundle + optional OCSP. |
| SAT AC4/AC5 + OCSP signer certs in `api/lib/firma/sat-cas/` | Optional drop-in; absent → honest `NOT_CONFIGURED`. |
| Live sign + OCSP with a real FIEL `.cer`/`.key` | **External gate** — needs contributor material + network. |

This document does **not** claim live FIEL E2E is done. Unit/integration tests cover:

- CRYPTO required rejects SESSION
- `providerStatus` reflects configured vs not
- provider throws / returns `NOT_CONFIGURED` when CAs missing
- SESSION labels never say FIEL

## Running live E2E (manual, off CI)

1. Place public AC4/AC5 (+ OCSP signer) certs per `api/lib/firma/sat-cas/README.md`.
2. Obtain a **test** FIEL (never commit `.key` / password).
3. Set `PA_EFIRMA_OCSP=1` and ensure outbound HTTPS to `https://cfdi.sat.gob.mx/edofiel`.
4. Call `firmas.create` with `kind: CRYPTO_SIGNATURE` and `crypto: { cerBase64, keyBase64, password }`.
5. Confirm `validationStatus` / OCSP evidence on the stored row.

CI must remain green without secrets. Treat live FIEL as a release checklist item, not a green build claim.
