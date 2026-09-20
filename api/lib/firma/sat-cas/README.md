# SAT CA / OCSP certificates (AC4 / AC5)

Piedra Angular `SatEFirmaProvider` requires issuer + OCSP-signer certificates to run
CRYPTO_SIGNATURE validation. Without them the provider reports `NOT_CONFIGURED`
(SESSION_CONFIRMATION still works for non-juridical confirmations).

**Never commit private keys, .key files, FIEL passwords, or contributor personal certificates.**

## Official source (public CA material only)

SAT publishes CSD / FIEL **authority** certificates (not end-entity FIEL) at:

1. Portal trámites — Certificado de sello digital / autoridades certificadoras  
   http://omawww.sat.gob.mx/tramitesyservicios/Paginas/certificado_sello_digital.htm
2. Related “Certificados de la Autoridad Certificadora” pages under sat.gob.mx  
   (look for AC4 / AC5 / AC Raíz downloads — DER `.cer` or PEM).
3. OCSP production endpoint for e.firma status: `https://cfdi.sat.gob.mx/edofiel`

Community docs (e.g. phpcfdi/credentials — VerificacionCertificadosSAT.md) describe using
`AC4_SAT` / `AC5_SAT` as `-issuer` against that OCSP URL, plus OCSP responder signer certs.

### How to drop certs into this directory

```bash
# From a workstation with access to the SAT download pages (no login for public CAs):
# 1) Download AC4_SAT.cer and AC5_SAT.cer (issuer / autoridad certificadora).
# 2) Download OCSP responder signer certs if published separately (name them OCSP_AC4.cer / OCSP_AC5.cer).
# 3) Copy ONLY those public certs here:

cp ~/Downloads/AC4_SAT.cer api/lib/firma/sat-cas/
cp ~/Downloads/AC5_SAT.cer api/lib/firma/sat-cas/
cp ~/Downloads/OCSP_AC4.cer api/lib/firma/sat-cas/   # if available
cp ~/Downloads/OCSP_AC5.cer api/lib/firma/sat-cas/   # if available

# Optional: convert DER → PEM
openssl x509 -inform DER -in AC4_SAT.cer -out AC4_SAT.pem
```

`loadSatCasBundle()` accepts `.cer` / `.crt` / `.pem` and classifies by filename:

| Filename pattern | Role |
|------------------|------|
| `*AC4*` / `*AC5*` / `*AC_*` / `*SAT*` / `*AUTORIDAD*` (without OCSP) | Issuer |
| `*OCSP*` | OCSP response signer |

If downloads fail, licensing is unclear, or files are absent, leave this folder with only
this README — the app stays on the honest `NOT_CONFIGURED` path (no fake FIEL).

Automated fetch from CI is **not** required; live E2E with real `.cer`/`.key` is an
external gate (see `docs/EFIRMA_E2E.md`).

## Env flags

- `PA_EFIRMA_OCSP=1` — enable live OCSP (default on when `NODE_ENV=production`)
- `PA_EFIRMA_OCSP=0` — skip OCSP (crypto signature still built; status stays PENDING until verified)
- `PA_EFIRMA_OCSP_FAIL_OPEN=0` — default **fail-closed** if OCSP unreachable for CRYPTO acts
- `PA_EFIRMA_SAT_CAS_DIR` — override this directory path

Live OCSP needs network + real FIEL fixtures (never commit secrets).
