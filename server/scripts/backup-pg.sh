#!/usr/bin/env bash
# Backup / restore helpers for Meridian PostgreSQL.
# Requires: pg_dump, pg_restore or psql, and DATABASE_URL (or PG* vars).
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  backup-pg.sh dump <output.sql>
  backup-pg.sh restore <input.sql>

Uses DATABASE_URL when set. Suitable for staging drills and CI smoke tests.
EOF
}

cmd="${1:-}"
file="${2:-}"

if [[ -z "$cmd" || -z "$file" ]]; then
  usage
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

# Prisma accepts `schema` in PostgreSQL connection URLs, but libpq tools such
# as pg_dump and psql reject that parameter. Preserve standard libpq options
# such as sslmode while removing only Prisma's schema selector.
postgres_url() {
  local url="$1"
  if [[ "$url" != *"?"* ]]; then
    printf '%s' "$url"
    return
  fi

  local base="${url%%\?*}"
  local query="${url#*\?}"
  local parameter
  local joined=""
  local parameters=()
  local IFS='&'

  read -r -a parameters <<< "$query"
  for parameter in "${parameters[@]}"; do
    if [[ -n "$parameter" && "${parameter%%=*}" != "schema" ]]; then
      joined="${joined:+$joined&}$parameter"
    fi
  done

  printf '%s' "$base"
  if [[ -n "$joined" ]]; then
    printf '?%s' "$joined"
  fi
}

POSTGRES_URL="$(postgres_url "$DATABASE_URL")"

case "$cmd" in
  dump)
    pg_dump --no-owner --format=plain --file="$file" "$POSTGRES_URL"
    echo "Wrote $file"
    ;;
  restore)
    # Plain SQL dump from `dump`.
    psql "$POSTGRES_URL" -v ON_ERROR_STOP=1 -f "$file"
    echo "Restored $file"
    ;;
  *)
    usage
    exit 1
    ;;
esac
