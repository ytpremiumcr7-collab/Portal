# ARES — corrida local (demo)

## Estado en la máquina del agente
- MariaDB 11.8 local en `localhost:3306`
- Base `ares`, usuario `ares` / `ares_dev_local`
- Migraciones `0001`–`0005` aplicadas (50 tablas)
- App Vite + API Hono en **http://localhost:3000/**

## Credenciales seed
- Email: `admin@ares.local`
- Password: `AresDemo2026!`

## Arranque
```bash
# MySQL ya corriendo, luego:
cp .env.example .env   # o usar el .env local
npm install
./scripts/migrate-local.sh
npx tsx db/seed.ts
npm run dev -- --host 0.0.0.0 --port 3000
```

## Docker (alternativa)
```bash
docker compose up -d mysql
# esperar healthy, luego seed + npm run dev
```
