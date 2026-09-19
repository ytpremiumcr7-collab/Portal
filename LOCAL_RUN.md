# Piedra Angular — corrida local

## Estado en la máquina del agente
- MariaDB 11.8 local en `localhost:3306`
- Base `ares`, usuario `ares` / `ares_dev_local`
- Migraciones `0001`–`0013` aplicadas
- App Vite + API Hono en **http://localhost:3000/**

## Bootstrap de operaciones (`db/seed.ts`)
Herramienta de arranque operativo (no es un “modo producto”). Crea un tenant y admin iniciales:

- Email: `admin@ares.local`
- Password: `AresDemo2026!` (configurable vía `SEED_*` en `.env`)

## Arranque
```bash
# MySQL ya corriendo, luego:
cp .env.example .env   # o usar el .env local
npm install
./scripts/migrate-local.sh
npx tsx db/seed.ts     # opcional: bootstrap de ops
npm run dev -- --host 0.0.0.0 --port 3000
```

## Registro público
- Desarrollo: permitido salvo `ARES_ALLOW_PUBLIC_REGISTER=false`
- Producción (`NODE_ENV=production`): deshabilitado salvo `ARES_ALLOW_PUBLIC_REGISTER=true`

## Docker (alternativa)
```bash
docker compose up -d mysql
# esperar healthy, luego migrate + seed + npm run dev
```
# Nota: docker-compose monta migraciones 0001–0013 en initdb.


## SMTP / outbox (producción)
```bash
# Opción A — URL
export ARES_SMTP_URL='smtp://user:pass@mail:587'
export ARES_SMTP_FROM='noreply@entidad.gob.mx'

# Opción B — discreto
export SMTP_HOST=mail.example.gov.mx
export SMTP_PORT=587
export SMTP_USER=...
export SMTP_PASS=...
export SMTP_FROM=noreply@entidad.gob.mx

# Worker
npm run outbox:once
npm run outbox:worker   # loop + lease reclaim
```
Webhook: `ARES_SMTP_URL=https://hooks.example/mail` (path no-SMTP).

## Economic envelope

Set `ARES_ENVELOPE_KEY` (32-byte base64 or hex) and optional `ARES_ENVELOPE_KEY_VERSION` / `ARES_ENVELOPE_KEY_V{n}` for rotation. Apply migration `0014_sobre_economico.sql`.


## Legacy plaintext sobres + system actors

```bash
# Ensure system actors for ALL tenants (also runs inside db/seed.ts)
npx tsx scripts/migrate-legacy-sobres.ts --dry-run
npx tsx scripts/migrate-legacy-sobres.ts   # requires ARES_ENVELOPE_KEY to encrypt

# Capability note: convocante operational acts need procedimiento_asignaciones.
# One-shot for new procedimiento creator only:
#   sod.bootstrapAsignaciones({ licitacionId, motivo })  → rol «creador» only
```
