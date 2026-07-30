# Back up and restore PostgreSQL

PostgreSQL is Meridian's durability boundary. Redis is not a document backup.
This procedure uses the repository's `backup-pg.sh`; it requires `pg_dump` and
`psql` from a PostgreSQL client installation and network access to the database.

## Create a backup

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
