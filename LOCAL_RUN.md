# ARES — corrida local

## Estado en la máquina del agente
- MariaDB 11.8 local en `localhost:3306`
- Base `ares`, usuario `ares` / `ares_dev_local`
- Migraciones `0001`–`0010` aplicadas
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
# Nota: docker-compose monta migraciones 0001–0010 en initdb.
