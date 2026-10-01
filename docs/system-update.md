# Managed system updates

The administrator's **Update system** action creates one server-generated plan
for Console backend and web. It only installs compatible official stable
releases with finalized manifests. Components already at their target version
are retained. The default updater does not schedule upgrades on startup or on
a timer; a restart only resumes an existing job.

The initial feature release is a bootstrap baseline. Older releases without
the maintenance protocol, build identity and complete manifests cannot be
adopted merely by adding a button or changing an image tag. They continue to
support the original version check and manual upgrade.

## Standard Docker installation

Use the official docker-compose.yml **and** docker-compose.override.yml in a
dedicated directory on the Linux Docker host. The override starts with empty
services and is exclusively managed by the updater. Move an existing user's
override settings into the base configuration before adopting this layout;
registration refuses to overwrite a populated override.

Create a protected .env in that same directory. Set JWT_SECRET and
ADMIN_PASSWORD to your own values and set CONSOLE_INSTALL_DIR to the **actual
absolute host directory**, for example /opt/rustdesk-console-compose. Run the
normal docker compose up -d from that directory. This starts backend, web and
updater together; there is no updater profile or separate enabling command.
Keep the directory short: the UTF-8 encoded path
CONSOLE_INSTALL_DIR/updater-ipc/control.sock must be shorter than 108 bytes.
A long project path can prevent the updater from opening its Unix socket.

The updater verifies Compose labels, configuration hashes, .env, service
identity, real mounts, published release metadata and current image content.
It then records the installation and pins the exact running images in the
managed override. If necessary it pulls that same digest under its official
GHCR reference and verifies the image ID is unchanged. It never chooses a
newer release during registration. A separate immutable registration
container completes replacement of the helper's tag reference, so stopping
the original helper cannot abandon the operation.

The directory contains:

| Path                        | Purpose                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| data/                       | SQLite and business files; application UID/GID 1000               |
| updater-state/              | Root-only installation record, jobs, plans and recovery backups   |
| updater-ipc/                | Root/UID-1000 group restricted Unix socket                        |
| updater-maintenance/        | Persistent non-secret maintenance marker; backend mount read-only |
| docker-compose.override.yml | Only backend/web/updater image digests                            |

Ordinary legacy Docker deployments keep their configured process identity and
existing data ownership. The backend adopts UID/GID 1000 only when both managed
socket and maintenance paths are configured, as in the standard Compose file.
Neither the image entrypoint nor registration recursively changes existing
files. Before adopting the managed layout, stop all old writers, validate an
offline database-and-files backup, and restore it into a separate data directory
with ownership appropriate for UID/GID 1000. Verify database and business-file
writes before switching traffic, and retain the original data and backup.
Changing a parent directory owner alone does not make existing root-owned
SQLite files writable by the managed application.

The real project path is mounted at the identical absolute path in the helper
and workers. /install is an additional inspected alias, never a substitute for
a host bind source. Do not change CONSOLE_INSTALL_DIR after registration.
Configuration or environment drift blocks execution; it does not silently
reconstruct a guessed deployment. External includes and env_file layouts must
be migrated into the recorded standard configuration. Arbitrary source builds,
remote/rootless Docker daemons and nonstandard orchestration are not adopted.

Only updater and job containers receive the Docker socket. No container uses
privileged: true, and the helper exposes no TCP port. **Access to the Docker
socket still confers strong host control.** The smaller IPC API does not remove
that privilege. Keep the installation directory and .env protected, and do
not mount the private state or project directory in a business container.

Normal subsequent docker compose up reads the committed digest override. The
updater uses service-specific operations with --no-deps; it never runs project
down, removes volumes, or upgrades an external database, hbbs or hbbr.

## Standard Linux installation

Download the complete official backend Linux archive matching the host CPU
and libc and verify its published SHA-256. Extract it into a staging directory.
Run deployment/install-linux.sh as root, optionally providing --backend-tag,
--web-tag and --config with a protected initial KEY=value file. Tags must be
stable official releases; otherwise the latest official finalized pair is
selected and checked for mutual compatibility.

The installer requires a host actually booted with systemd. It automatically
installs the required Python, SQLite, MySQL/MariaDB client and flock tools using
apt-get, dnf or apk, verifies and downloads both complete official bundles,
creates the business account and installs all services. There is no second
helper installation step. It checks the backend, web, proxied API and local IPC
before reporting readiness. Credentials generated for a fresh installation
remain in /etc/rustdesk-console/backend.env (root-only); they are not printed.

The standard paths are:

| Path                                                                | Purpose                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| /opt/rustdesk-console/releases/backend/VERSION                      | Complete immutable SEA release, native addons and templates                     |
| /opt/rustdesk-console/releases/web/VERSION                          | Complete immutable Rust web release                                             |
| /opt/rustdesk-console/current-backend, current-web, current-updater | Managed release links                                                           |
| /etc/rustdesk-console                                               | Protected environment files, installation metadata and database credential file |
| /var/lib/rustdesk-console                                           | Business data                                                                   |
| /var/lib/rustdesk-console-updater                                   | Private job journals, backups and immutable worker links                        |
| /var/lib/rustdesk-console-maintenance                               | Persistent maintenance fence, readable by the application                       |
| /run/rustdesk-console-updater                                       | Restricted IPC; contains no sole copy of persistent maintenance state           |

The fixed units are rustdesk-console-backend.service,
rustdesk-console-web.service, rustdesk-console-updater.service and
rustdesk-console-update-job@.service. Business services run as rustdesk-console;
the updater and job services hold deployment rights. A job starts from a
root-owned per-job link to the **old complete backend release**, independently
of current-updater. Its unit has no PartOf/BindsTo relationship with the helper.
The protected installation record hashes backend.env, web.env, updater.env and
the MySQL password file when present. A changed or missing file blocks planning
and execution until the installation configuration is deliberately reconciled;
configuration contents are never returned through the update API.

The installer refuses existing application data, configuration, service files
or current release links. It does not reinterpret an arbitrary existing
systemd service. For an older installation, first take and validate an offline
database/file backup, stop all old writers, prepare the standard layout in an
isolated instance with the intended official baseline, migrate the complete
data and original environment while stopped, and verify authentication,
business data, paths and database configuration before switching traffic.
Keep the original backup and configuration. A database upgrade may change the
schema; copying an older executable back is not a data restore.

### Disk space and retained materials

There is no fixed 8 GiB installation or 2 GiB update free-space requirement.
The installer checks downloads, validated archive expansion and the final
backend/web copies against the filesystem that receives each write. Files
are rounded to allocation blocks and each phase includes 64 MiB of headroom.
With /var/tmp and /opt on one filesystem, compressed archives, expanded trees
and installed copies coexist at the installation peak; already allocated
staging bytes are reflected in current free space. Separate filesystems are
checked separately. Host packages, business data and retained backups need
additional capacity. Archive expansion limits are security bounds, not
minimum VPS disk sizes.

Native update readiness reserves 16 MiB on the release filesystem. After
download and integrity verification, every archive entry is validated and
its block-rounded expanded size, directory blocks and the 16 MiB reserve are
checked before writing bundle contents. This happens during preparation,
before maintenance or service switching; plan preview does not yet know the
expanded archive size. Compressed archives stay in memory and publishing
uses a same-filesystem rename. Each changed component is checked against
then-current free space. A handled preparation failure removes only its own
unpublished staging directory; cleanup failure or process termination can
leave that directory for investigation. Existing verified releases and other
jobs remain preserved.

Backup capacity remains data-dependent: the adapter requires three times the
estimated database-plus-business-file size plus 64 MiB on the backup and
restoration filesystems. It does not delete backups or unresolved recovery
materials to pass a space check. This first version does not automatically
prune old releases or recovery snapshots; budget for retained history and
review it administratively after confirming no active or unresolved job
depends on it. Checks estimate space rather than reserve it: later I/O
failures still use the normal fail-closed update and recovery path.

## MySQL protection

Set the existing DB_TYPE, DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD and
DB_DATABASE deployment values. Explicitly confirm a schema dedicated to Console
with SYSTEM_UPDATE_MYSQL_EXCLUSIVE_SCHEMA=true. MySQL deployments still retain
business files in DATA_DIR, which are included in the recovery set.

The backup account needs PROCESS visibility and the restore/inspection rights
on this application's schema. It does not need global CREATE DATABASE or
SUPER. The current adapter supports the application's InnoDB base-table layout;
unknown external writers, unsafe objects, inadequate permissions, mismatched
tools or insufficient storage block execution. A successful database connection
alone is not proof that backup and restore can run. Standard Docker includes
mariadb-connector-c for MySQL caching_sha2_password authentication.

Passwords are passed through restricted option files, never command-line
password arguments. Keep backups protected like the live database: they contain
credentials and other sensitive business data. Shared business schemas cannot
be advertised as safely restorable.

## Recovery and commit decisions

Before a switch the worker persists maintenance, stops business writers and
backs up the database plus business files. It verifies the new versions and
proxy under maintenance and replaces the resident helper while the independent
old worker remains alive. Only after a durable commit_decided record may it
reopen business traffic. A successful rollback likewise records restore_decided
before reopening. Neither decision permits automatic replay of an older
snapshot over newly accepted writes.

If the WebUI cannot reconnect, retain the entire private state, old releases
and backups. Inspect the relevant service/container logs locally; do not paste
database credentials or full environment dumps into a public issue.

For Linux, run rustdesk-console-recover with the existing job UUID as root.
It validates and requests the same supervised job through its immutable old
worker. For Docker, use docker compose exec updater node /app/dist/main.js
--system-update-mode=recover --job-id= followed by that UUID. Do not start a
second job or delete an installation lock to force progress.

An interrupted restore whose outcome cannot be proved remains
recovery_required with maintenance active. The recovery command refuses unsafe
automatic replay; investigate the private journal and database with the
matching backup before taking further action. Do not clear maintenance or
replace a database after commit_decided/restore_decided to make an error vanish.

## Release finalization

Maintainers provide an explicit tested peer_version_range when dispatching a
release. All Docker and native bundles are built from the same version commit.
Each complete bundle contains build-info.json and release-metadata.json. The
backend finalize job depends on every native and musl build, validates the
uploaded assets and Docker descriptor, and uploads update-manifest.json last.
Failure or a missing counterpart manifest leaves the target unavailable for
automatic execution. A published release tag alone is not sufficient.

Linux glibc bundles are built in the Node 24 Debian Bookworm image (glibc 2.36).
The SEA build compiles sqlite3 inside that baseline and loads both sqlite3 and
sharp before packaging. Do not substitute a newer host-built native addon: its
glibc requirement can exceed the bundle baseline even when installation succeeds.
The packaging step converts native build hard links and internal file symlinks
into regular files before archiving; both the installer and updater reject
archive link entries.

The September 2026 qualification image contains Node 24.19.0, Docker CLI
29.5.3, Compose 5.1.4, SQLite 3.53.4, MariaDB client/dump 11.8.8 and
util-linux 2.42.3. The glibc SEA qualification bundle uses Node 24.21.0 and
Debian glibc 2.36. These are observed build versions, not a claim that every
database/client combination is qualified. Linux installation uses the host
distribution packages; record their actual versions alongside the target
MySQL version when running backup, restore and full lifecycle qualification.

Before the feature is officially released, complete local bundles and a test
catalog can exercise installation in a disposable environment. Such evidence
must identify the fixture seam and cannot establish official release
provenance. Standard registration still requires the finalized official
manifests and the exact running official image digests.

Keep the current and most recent successful recovery materials; this first
version does not automatically prune them. Real release qualification must
exercise Docker/SQLite, Docker/MySQL, Linux/SQLite and Linux/MySQL with success,
failure recovery, helper replacement, reboot and post-decision write retention.
Unit tests, image builds and mocked health responses do not replace that matrix.
