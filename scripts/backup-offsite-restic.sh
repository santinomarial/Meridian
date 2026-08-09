#!/usr/bin/env bash
set -Eeuo pipefail

if (( $# != 2 )); then
  echo "Usage: backup-offsite-restic.sh DUMP_FILE CHECKSUM_FILE" >&2
  exit 1
fi

dump_file="$1"
checksum_file="$2"

for file in "$dump_file" "$checksum_file"; do
  if [[ "$file" != /* ]]; then
    echo "Backup artifact path must be absolute: $file" >&2
    exit 1
  fi
  if [[ ! -f "$file" || ! -r "$file" ]]; then
    echo "Backup artifact is not a readable file: $file" >&2
    exit 1
  fi
done

if ! command -v restic >/dev/null 2>&1; then
  echo "restic is required for encrypted off-host backup upload" >&2
  exit 1
fi
if [[ -z "${RESTIC_REPOSITORY:-}" ]]; then
  echo "RESTIC_REPOSITORY is required" >&2
  exit 1
fi
if [[ -z "${RESTIC_PASSWORD:-}" && -z "${RESTIC_PASSWORD_FILE:-}" && -z "${RESTIC_PASSWORD_COMMAND:-}" ]]; then
  echo "Configure RESTIC_PASSWORD_FILE or another restic password source" >&2
  exit 1
fi

restic backup --tag meridian -- "$dump_file" "$checksum_file"
