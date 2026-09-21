# Piedra Angular

Plataforma transaccional de **contratación pública** de los Estados Unidos Mexicanos.

Límite de producto: **ARES only**. No se mezcla con plataformas de preparación de obra. Piedra Angular contrata, administra y gobierna el expediente.

## Ciclo

planeación → investigación de mercado → convocatoria → aclaraciones → recepción / apertura → evaluación → dictamen → fallo → acto de adjudicación → contrato → garantías → ejecución → pagos → incidencias / sanciones / inconformidades → consulta pública.

No es un CRUD. Cada acto material es un agregado con estados, gates, SoD y evidencia encadenada.

## Local

Ver `LOCAL_RUN.md`.

```bash
cp .env.example .env
docker compose up -d
bash scripts/migrate-local.sh
npm install
npm run dev
npm run seed:ops
```

## Gobierno (honesto)

| Control | Estado |
|---|---|
| Expediente | Cadena v1 histórica + **v2** en eventos nuevos (tenant, IP, requestId institucional) |
| Firma de sesión | `SESSION_CONFIRMATION` — no es e.firma / FIEL |
| e.firma / FIEL | `SatEFirmaProvider` + OCSP si hay AC4/AC5; si no, `NOT_CONFIGURED` |
| TSA | Anclas `PENDING_EXTERNAL` hasta `ARES_TSA_URL` |
| Documentos | SHA-256 + object version id (filesystem versionado; S3 opcional) |
| Legal hold | Tablas + bloqueo de purga |
| SoD apertura | Roles especializados. Si no están asignados, `creador` opera y el evento registra `CONCENTRATED_CREADOR` |
| IM | `FUENTE_CAPTURADA` (autoridad + fuente + documento) ≠ `RESPUESTA_PROVEEDOR` (token) |

Flags (default off): `ARES_REQUIRE_CRYPTO_FIRMA`, `ARES_REQUIRE_STEP_UP`, `ARES_APERTURA_SOD_STRICT`.

`docs-audit-brief.md` es **histórico**. Arquitectura vigente: `ARCHITECTURE.md`. FIEL live: `docs/EFIRMA_E2E.md`.

```bash
npx tsc -b
npm test
npm run test:static
```
