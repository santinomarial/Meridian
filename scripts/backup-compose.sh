#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_file="${COMPOSE_FILE:-${script_dir}/../docker-compose.prod.yml}"
backup_dir="${BACKUP_DIR:-/var/backups/meridian}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"
offsite_required="${BACKUP_OFFSITE_REQUIRED:-false}"
offsite_hook="${BACKUP_OFFSITE_HOOK:-}"

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: backup-compose.sh

Creates an atomic, custom-format PostgreSQL dump from the production Compose
postgres service. Configuration:
  COMPOSE_FILE             default: ../docker-compose.prod.yml
  BACKUP_DIR               default: /var/backups/meridian
  BACKUP_RETENTION_DAYS    default: 14
  BACKUP_OFFSITE_REQUIRED  default: false
  BACKUP_OFFSITE_HOOK      absolute executable path; receives dump and checksum
EOF
  exit 0
fi

if [[ -z "$backup_dir" || "$backup_dir" == "/" ]]; then
  echo "Refusing unsafe BACKUP_DIR: ${backup_dir:-<empty>}" >&2
  exit 1
fi
if [[ ! "$retention_days" =~ ^[0-9]+$ ]] || (( retention_days < 1 )); then
  echo "BACKUP_RETENTION_DAYS must be a positive integer" >&2
  exit 1
fi
if [[ "$offsite_required" != "true" && "$offsite_required" != "false" ]]; then
  echo "BACKUP_OFFSITE_REQUIRED must be true or false" >&2
  exit 1
fi
if [[ "$offsite_required" == "true" && -z "$offsite_hook" ]]; then
  echo "BACKUP_OFFSITE_HOOK is required when BACKUP_OFFSITE_REQUIRED=true" >&2
  exit 1
fi
if [[ -n "$offsite_hook" ]]; then
  if [[ "$offsite_hook" != /* ]]; then
    echo "BACKUP_OFFSITE_HOOK must be an absolute path" >&2
    exit 1
  fi
  if [[ ! -x "$offsite_hook" ]]; then
    echo "BACKUP_OFFSITE_HOOK is not executable: $offsite_hook" >&2
    exit 1
  fi
fi
if [[ ! -f "$compose_file" ]]; then
  echo "Compose file not found: $compose_file" >&2
  exit 1
fi

install -d -m 700 "$backup_dir"
backup_dir="$(cd "$backup_dir" && pwd -P)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="${backup_dir}/meridian-${timestamp}.dump"
if [[ -e "$destination" || -e "${destination}.sha256" ]]; then
  echo "Backup already exists for timestamp $timestamp" >&2
  exit 1
fi
partial="$(mktemp "${backup_dir}/.meridian-XXXXXX.dump")"
trap 'rm -f "$partial"' EXIT
chmod 600 "$partial"

docker compose -f "$compose_file" exec -T postgres \
  pg_dump --username=meridian --dbname=meridian --no-owner --format=custom \
  > "$partial"

test -s "$partial"
docker compose -f "$compose_file" exec -T postgres \
  pg_restore --list < "$partial" > /dev/null
mv "$partial" "$destination"
destination_name="$(basename "$destination")"
(
  cd "$backup_dir"
  sha256sum "$destination_name" > "${destination_name}.sha256"
)
chmod 600 "$destination" "${destination}.sha256"

if [[ -n "$offsite_hook" ]]; then
  "$offsite_hook" "$destination" "${destination}.sha256"
  date -u +%s > "${backup_dir}/last-offsite-success.unixtime"
  chmod 600 "${backup_dir}/last-offsite-success.unixtime"
fi

date -u +%s > "${backup_dir}/last-success.unixtime"
chmod 600 "${backup_dir}/last-success.unixtime"

find "$backup_dir" -type f \
  \( -name 'meridian-*.dump' -o -name 'meridian-*.dump.sha256' \) \
  -mtime "+${retention_days}" -delete

echo "Wrote $destination"
