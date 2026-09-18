#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for f in 0001_ares_mexico_baseline.sql 0002_phase1_expediente.sql 0003_phase2_dominios_transaccionales.sql 0004_phase3_ciclo_completo.sql 0005_audit_harden_sod.sql 0006_sod_procedimiento.sql; do
  echo "Applying $f ..."
  mysql -u ares -pares_dev_local ares < "$ROOT/db/migrations/$f"
done
echo "Migraciones 0001-0006 aplicadas."
