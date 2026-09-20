#!/usr/bin/env bash
# MariaDB docker-entrypoint-initdb.d hook: apply every migration in order.
# Mounted as /docker-entrypoint-initdb.d/99-migrate.sh with migrations at
# /docker-entrypoint-initdb.d/migrations/*.sql
set -euo pipefail
MIG_DIR="/docker-entrypoint-initdb.d/migrations"
echo "ARES docker init: applying migrations from $MIG_DIR"
shopt -s nullglob
files=("$MIG_DIR"/*.sql)
IFS=$'\n' sorted=($(printf '%s\n' "${files[@]}" | sort))
for f in "${sorted[@]}"; do
  echo "Applying $(basename "$f") ..."
  mysql -u root -p"${MYSQL_ROOT_PASSWORD}" -e "CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\`;"
  mysql -u root -p"${MYSQL_ROOT_PASSWORD}" "${MYSQL_DATABASE}" < "$f"
done
echo "ARES docker init: ${#sorted[@]} migrations applied."
