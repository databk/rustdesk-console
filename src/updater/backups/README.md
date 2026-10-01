# Managed database snapshots

This module implements the private `BackupAdapter` contract from
`../contracts.ts`. Construct it with `createBackupAdapter(installation.database)`.
The worker supplies one private `backupDir` per job, outside `DATA_DIR` and outside
the restored database. It must persist maintenance and stop **all** application
writers before setting `servicesStopped: true`. The adapter refuses backup and
restore without this proof. It does not decide when recovery is permitted.

The runtime must persist the restore intent before calling `restore`, and must
never call it after a durable `commit_decided` or `restore_decided`. Restoring the
old executable and verifying application startup are runtime responsibilities.
A failed import, file restore, integrity check, or unknown result must keep the
installation in maintenance / `recovery_required`. These methods never reopen
business traffic and never report the whole update as successful.

## Default client installation contract

- Install `sqlite3` >= 3.30 with the standard updater image / Linux installer.
- Install a matching `mysql` + `mysqldump` 8.0 / 8.4 pair, or matching
  `mariadb` + `mariadb-dump` clients from MariaDB 10.11+ or 11.x. MariaDB aliases
  `mysql` / `mysqldump` are detected by their version output. Client authentication
  plugins are required too: Alpine additionally needs `mariadb-connector-c` for
  MySQL 8 `caching_sha2_password` authentication. A bare `mariadb-client` package
  does not include that plugin. Query-client `connect-timeout` is not placed in
  the shared option-file section because MariaDB dump clients reject it.
- Required server families are MySQL 8.0 / 8.4 and MariaDB 10.11+ / 11.x. Oracle
  clients are not used to restore MariaDB servers. Supported release series are
  capability checks; actual validated combinations must also be recorded by the
  release integration matrix. A detected version is not integration evidence.
- No tool is downloaded or installed while updating. No secondary production
  MySQL server or scratch production database is required.

## SQLite

The configured SQLite file must be directly inside the managed data directory.
Backup invokes the SQLite CLI `.backup` API against the database, including
committed WAL contents. It never makes an online copy of only the `.db` file.
Source and backup must pass `PRAGMA integrity_check`; the backup and business
files are hashed and synchronized before publishing the immutable snapshot.

Recovery verifies the snapshot before touching live data, preserves the failed
database and its `-wal`, `-shm`, and `-journal` files in a private quarantine, and
then restores the database and matching business files. It preserves file modes
and owner/group identifiers and validates the recovered database. Stale target
WAL contents cannot be replayed onto the restored snapshot.

## MySQL safety boundary

`exclusiveSchema: true` is an installation assertion that the named schema is
owned by this Console only: no other applications, users, scheduled SQL, external
DDL jobs, cross-schema dependencies, or event/routine writes may target it. This cannot be
inferred from a successful connection. The adapter additionally checks visible
sessions, visible cross-schema foreign keys, current grants, server/client series, writable server status, object
inventory, and configured TLS. It rechecks after the application is stopped and
after the dump. Session checks cannot revoke a separately privileged external
operator; deployments unable to ensure the exclusivity assertion must not enable
automatic recovery.

Automatic snapshots support the upstream Console schema of InnoDB base tables.
Custom views, triggers, stored routines, events, non-InnoDB engines, unusual object
names, or more than 512 objects are explicit blockers. The global event scheduler
may be enabled when there are no events in the dedicated schema and the
exclusivity assertion excludes external writers. Target-version application
events must be inactive before recovery. Unknown deployment conditions remain
unsupported; they do not become a successful update.

The connection account needs `PROCESS` on `*.*` for visibility of other sessions,
and either `ALL PRIVILEGES` **on the application schema only** or these direct
schema privileges:

```text
SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES,
SHOW VIEW, TRIGGER, EVENT, EXECUTE, ALTER ROUTINE
```

`EVENT`, `TRIGGER`, `SHOW VIEW`, and routine privileges make object inspection
complete and allow cleanup of objects introduced by a failed target version.
Opaque role-only grants are rejected when the required direct permissions cannot
be proved. Global `CREATE DATABASE`, `SUPER`, account changes, global DDL, and
production trial DROP/recreate operations are not required or performed.

The dump uses single-transaction, quick streaming, hex binary values, no
tablespaces, no table locks, UTC timestamp handling, and utf8mb4 client encoding.
Oracle clients additionally disable GTID-purged statements and column statistics;
these Oracle-only flags are not passed to MariaDB. No `--databases`, `--force`,
master replication metadata, global setting, or account statement is requested.

The password comes from a private regular `passwordFile` (0600 on Linux). A
private temporary option file safely quotes credentials, host and TLS paths.
Arguments, logs, API projections and exception messages never contain passwords,
raw SQL, data, or client stderr. The subprocess environment does not inherit
`MYSQL_PWD` or login-path overrides. Configured CA / certificate / key and
`rejectUnauthorized` behavior are retained; a requested TLS connection must
actually negotiate a cipher. Without TLS configuration, this adapter does not
silently claim transport encryption.

A completed dump must have a successful client exit and completion footer, a
recorded SHA-256, and stable before/after table proofs (row count, extended table
checksum and CREATE TABLE digest). Validation of a dump is **not** a production
trial restore. Real restore testing belongs to isolated release integration.

Recovery keeps the existing dedicated database and its character set/collation.
It binds the configured endpoint, exact server version and server identity
(MySQL server UUID; MariaDB hostname/server ID) to the private snapshot. It lists
current objects, then drops only qualified objects inside
that schema before importing the preserved dump. This also removes tables/views/
routines/events introduced by the failed target. SQL DDL is not transactional;
import failures remain isolated. Restored table names, definitions, counts and
checksums must match before business files are restored. A sibling schema is
never included in cleanup or import.

## Snapshot format and filesystem boundary

```text
<private per-job backupDir>/
  snapshot/
    snapshot.json          # format 1, bound to job/database/DATA_DIR
    database.sqlite        # SQLite only
    database.sql           # MySQL only
    files/                 # all native business data, including empty directories
  .snapshot-*/             # retained incomplete staging, never accepted as snapshot
  displaced-sqlite-*/      # failed database and named sidecars
  displaced-files-*/
    intent.json
    files/                 # retained target-version business file state
    restored.json          # only after matching business file restoration
```

The worker persists the returned `BackupSnapshot` receipt with
`metadata.manifestSha256`. `snapshot.json` contains database size/hash, file
size/hash/mode/uid/gid inventory, job identity, database binding, and the private
engine-specific proof. It contains no credentials. Snapshot directories are 0700
and files 0600; database contents and file inventories are nevertheless sensitive
and must never be returned by the public API.

Symlinks (including parent paths), hard-linked files and special files are
rejected. Files are bounded to 100,000 entries; inspection stdout is bounded and
commands have deadlines. Updater state, credentials and configuration must live
outside `DATA_DIR`. Deployment configuration backup remains with the deployment
adapter. Local disk preflight reserves space for snapshot, displaced state and
restore; external MySQL server storage exhaustion still produces a real failure
and requires operator recovery. No accepted snapshot or displaced state is
automatically deleted.

## Verification

Colocated Jest tests cover process isolation, output limits/timeouts, secrets,
private filesystem snapshots, corruption, stopped-writer proofs, schema-only
privileges, client/TLS branches, unsupported schema conditions, dump failure and
failed restore behavior. These contract tests inject the MySQL command boundary.
The real CLI/database tests live in `test/system-update/` under the integration
owner. Their evidence is required separately for Docker/Linux and SQLite/MySQL.
