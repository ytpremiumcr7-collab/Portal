#!/usr/bin/env bash
# Apply ALL db/migrations/*.sql in lexical order (same set as CI / docker init).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="$ROOT/db/migrations"
shopt -s nullglob
files=("$MIG_DIR"/*.sql)
if ((${#files[@]} == 0)); then
  echo "No migrations found in $MIG_DIR" >&2
  exit 1
fi
IFS=$'\n' sorted=($(printf '%s\n' "${files[@]}" | sort))
for f in "${sorted[@]}"; do
  echo "Applying $(basename "$f") ..."
  mysql -u ares -pares_dev_local ares < "$f"
done
echo "Migraciones aplicadas (${#sorted[@]} archivos)."
