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

case "$cmd" in
  dump)
    pg_dump --no-owner --format=plain --file="$file" "$DATABASE_URL"
    echo "Wrote $file"
    ;;
  restore)
    # Plain SQL dump from `dump`.
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file"
    echo "Restored $file"
    ;;
  *)
    usage
    exit 1
    ;;
esac
