# Back up and restore PostgreSQL

PostgreSQL is Meridian's durability boundary. Redis is not a document backup.
The automated procedure runs PostgreSQL tools inside the private Compose
container. The manual/CI procedure uses the repository's `backup-pg.sh` and
requires `pg_dump` and `psql` from a PostgreSQL client installation with network
access to the database.

## Create a backup

### Automated Compose backup

The repository includes `scripts/backup-compose.sh` and systemd timer units for
the supported one-VPS topology. The script runs `pg_dump` inside the private
PostgreSQL container, writes an atomic custom-format dump with a SHA-256 sidecar,
and removes matching local dumps after the configured retention period.

The systemd service fails closed unless the encrypted off-host upload is
configured. Install `restic`, initialize an approved remote repository, install
the repository at `/opt/meridian`, and create its root-readable configuration:

```bash
sudo install -d -m 700 /etc/meridian
sudo install -m 600 deploy/systemd/meridian-backup.env.example /etc/meridian/backup.env
sudo install -m 600 /dev/null /etc/meridian/restic-password
sudoedit /etc/meridian/backup.env /etc/meridian/restic-password
sudo install -d -m 700 /var/backups/meridian
sudo install -m 644 deploy/systemd/meridian-backup.service /etc/systemd/system/
sudo install -m 644 deploy/systemd/meridian-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now meridian-backup.timer
sudo systemctl start meridian-backup.service
sudo systemctl status meridian-backup.service meridian-backup.timer
sudo test -s /var/backups/meridian/last-success.unixtime
sudo test -s /var/backups/meridian/last-offsite-success.unixtime
sudo bash -c 'set -a; source /etc/meridian/backup.env; set +a; cd /opt/meridian; exec restic snapshots --tag meridian'
```

Use provider-native workload identity instead of static access keys when
available. `RESTIC_PASSWORD_FILE` must point to a strong, separately protected
secret; losing it makes the encrypted repository unrecoverable. The service
defaults to 14 days of local retention. Configure remote retention in the
backup platform, monitor both success timestamp files, and page when either is
more than 26 hours old. Do not put cloud credentials or restic passwords into
this repository or the Compose file.

`backup-compose.sh` calls the absolute executable in `BACKUP_OFFSITE_HOOK` with
the dump and checksum paths. When `BACKUP_OFFSITE_REQUIRED=true`, a missing or
failed hook prevents `last-success.unixtime` from advancing. The bundled
`backup-offsite-restic.sh` uploads both files in one encrypted restic snapshot.

Test an automated custom-format dump against a separate empty database with
`pg_restore --no-owner --exit-on-error --dbname=DATABASE_URL FILE.dump` before
go-live and after material schema changes.

### Manual/CI plain-SQL backup

Obtain `DATABASE_URL` from the deployment's secret store. The script removes
Prisma's `schema` query parameter while preserving standard libpq parameters.

Working directory: `server/`.

```bash
install -d -m 700 ../backups
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/meridian?schema=public'
BACKUP_FILE="../backups/meridian-$(date -u +%Y%m%dT%H%M%SZ).sql"
umask 077
./scripts/backup-pg.sh dump "$BACKUP_FILE"
test -s "$BACKUP_FILE"
```

Replace the connection details before running. The dump contains sensitive user
and document data. Run it only from a trusted host, protect the destination, and
do not commit it. The script must print `Wrote <path>`; `test -s` must exit
silently with status 0. Transfer the file to encrypted backup storage and apply
the approved retention policy.

For the bundled Compose deployment, PostgreSQL is intentionally not published
to the host. Run the script from an approved backup worker with access to the
internal Compose network; do not expose port 5432 publicly to make backups
easier.

## Test a restore

Provision a separate, empty database. Never rehearse against production. Use a
libpq-compatible URL without Prisma's `schema` parameter for the direct `psql`
checks below.

Working directory: `server/`.

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@RESTORE_HOST:5432/meridian_restore_drill'
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';"
./scripts/backup-pg.sh restore ../backups/meridian-YYYYMMDDTHHMMSSZ.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'SELECT 1 FROM "_prisma_migrations" LIMIT 1;'
```

The first query must print `0`. Stop if it does not: `backup-pg.sh restore` does
not create a database, drop objects, or clear an existing schema. It passes the
plain SQL dump to `psql -v ON_ERROR_STOP=1 -f`, so restoring over populated
objects can fail or mix data. A successful restore prints `Restored <path>`,
and the final query must return one row.

Start an isolated Meridian API against the restored database and perform a
read-only workspace/document check before deleting the drill environment.

## Recover production

1. Declare an incident, stop writes, and preserve the current database.
2. Provision an empty replacement database and restore the selected dump with
   the command above.
3. Validate migrations and representative row counts before changing
   `DATABASE_URL`.
4. Restart the entire API fleet. This is required so process-local Yjs state
   and Redis sequence seed state cannot remain on the pre-restore lineage.
5. Require every replica's `/ready` to return HTTP 200, then perform a
   read/write smoke test before restoring traffic.

See
[Persistence, compaction, and restore](../explanation/persistence-compaction-and-restore.md)
for the recovery boundary.
