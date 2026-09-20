# SAT CA / OCSP certificates (AC4 / AC5)

Piedra Angular `SatEFirmaProvider` requires issuer + OCSP-signer certificates to run
CRYPTO_SIGNATURE validation. Without them the provider reports `NOT_CONFIGURED`
(SESSION_CONFIRMATION still works for non-juridical confirmations).

## Official source

SAT CSD / FIEL authority certificates are published by the SAT at:

- http://omawww.sat.gob.mx/tramitesyservicios/Paginas/certificado_sello_digital.htm
- OCSP endpoint (production): `https://cfdi.sat.gob.mx/edofiel`

Community documentation (phpcfdi/credentials — VerificacionCertificadosSAT.md) describes
using `AC4_SAT` / `AC5_SAT` as `-issuer` against that OCSP URL.

## Expected files in this directory

| File | Role |
|------|------|
| `AC4_SAT.cer` or `AC4_SAT.pem` | Autoridad Certificadora 4 (issuer) |
| `AC5_SAT.cer` or `AC5_SAT.pem` | Autoridad Certificadora 5 (issuer) |
| `OCSP_AC4.cer` / `OCSP_AC5.cer` (or `.pem`) | OCSP response signer cert(s) for AC4/AC5 |

Place DER (`.cer`) or PEM files here. Do **not** commit private keys or contributor FIEL material.

## Env flags

- `PA_EFIRMA_OCSP=1` — enable live OCSP (default on when `NODE_ENV=production`)
- `PA_EFIRMA_OCSP=0` — skip OCSP (crypto signature still built; status stays PENDING until verified)
- `PA_EFIRMA_OCSP_FAIL_OPEN=0` — default **fail-closed** if OCSP unreachable for CRYPTO acts
- `PA_EFIRMA_SAT_CAS_DIR` — override this directory path

Live OCSP needs network + real FIEL fixtures (never commit secrets).
