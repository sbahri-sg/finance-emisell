#!/bin/sh
set -eu

deployment_env=${1:-.env.production}
backup_directory=${2:-backups}

if [ ! -f "$deployment_env" ]; then
  echo "File environment tidak ditemukan: $deployment_env" >&2
  exit 1
fi

mkdir -p "$backup_directory"
backup_file="$backup_directory/emisell-finance-$(date -u +%Y%m%dT%H%M%SZ).dump"

docker compose --env-file "$deployment_env" -f compose.production.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
  > "$backup_file"

test -s "$backup_file"
chmod 600 "$backup_file"
echo "Backup tersimpan: $backup_file"
