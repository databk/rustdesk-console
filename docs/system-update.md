# Managed system updates

Administrators use **Update system** to update the backend and web to one
compatible official stable release pair. Components already at their target
version remain unchanged. The updater starts with the deployment and resumes
interrupted jobs; it never initiates an upgrade without an administrator request.

## Standard Docker installation

Place `docker-compose.yml`, `docker-compose.override.yml` and a protected `.env`
in a dedicated directory on the Linux Docker host. Set unique `JWT_SECRET` and
`ADMIN_PASSWORD` values, and set `CONSOLE_INSTALL_DIR` to the actual absolute host
path. Run `docker compose up -d` in that directory. Backend, web and updater start
together. The override must initially contain only `services: {}` and is reserved
for the updater image digests.

Registration verifies the running Compose services, mounts, configuration hashes,
official manifests and immutable image digests. It records and pins the current
release without selecting a newer version. An independent registration container
finishes pinning the updater itself.

When registration cannot complete, the updater logs
`Updater registration unavailable: <reason>` and exits, and Compose restarts it
to try again. The reason names the deployment requirement that is not met, for
example `The managed override must start with empty services.`, or the error
code of a failed operation such as `COMMAND_FAILED`. Command output and
configuration values are never logged.

| Path                          | Purpose                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| `data/`                       | SQLite and business files, owned by application UID/GID 1000 |
| `updater-state/`              | Root-only installation, plans, jobs and recovery backups     |
| `updater-ipc/`                | Restricted Unix socket, readable by the application group    |
| `updater-maintenance/`        | Persistent maintenance fence, mounted read-only by the API   |
| `docker-compose.override.yml` | Backend, web and updater image digests                       |

The host project is mounted at the identical absolute path in updater and job
containers. Its socket path must be shorter than 108 UTF-8 bytes. Do not change
the directory after registration. Configuration drift blocks execution. External
Compose includes, `env_file`, remote/rootless daemons and arbitrary orchestration
are outside the managed deployment contract.

Only updater and job containers receive the Docker socket. This grants host
control even without `privileged: true`; protect the project and `.env`, and
never mount private deployment state into business containers. The backend runs
as UID/GID 1000; existing files must already be writable by that account. Normal
startup runs the official database migrations before serving requests.

Subsequent Compose startup reads the pinned override. Updates operate on the
application services with `--no-deps`. They do not run project `down`, remove
volumes, upgrade MySQL, or change hbbs/hbbr services.

## Standard Linux installation

Download the complete official backend archive matching the host CPU and libc,
verify its SHA-256, extract it, and run `sudo ./deployment/install-linux.sh`.
Optional arguments are `--backend-tag`, `--web-tag` and `--config` with a protected
initial `KEY=value` file. Releases must be stable, complete and mutually compatible.

The installer requires a fresh Linux host layout booted with systemd. It prepares
Python, SQLite, MySQL/MariaDB clients and flock through apt-get, dnf or apk; verifies
both bundles; creates the application account; and installs backend, web, updater
and job services. Existing data, configuration, service files and release links
are rejected. No arbitrary service or old installation is automatically adopted.
Initial credentials remain in root-only `/etc/rustdesk-console/backend.env`.

| Path                                                   | Purpose                                          |
| ------------------------------------------------------ | ------------------------------------------------ |
| `/opt/rustdesk-console/releases/{backend,web}/VERSION` | Complete immutable release bundles               |
| `/opt/rustdesk-console/current-{backend,web,updater}`  | Managed release links                            |
| `/etc/rustdesk-console/`                               | Protected configuration and installation record  |
| `/var/lib/rustdesk-console/`                           | Business data                                    |
| `/var/lib/rustdesk-console-updater/`                   | Private journal, backups and immutable job links |
| `/var/lib/rustdesk-console-maintenance/`               | Persistent maintenance fence                     |
| `/run/rustdesk-console-updater/`                       | Restricted updater socket                        |

Fixed units are `rustdesk-console-backend.service`, `rustdesk-console-web.service`,
`rustdesk-console-updater.service` and `rustdesk-console-update-job@.service`.
Business services run as `rustdesk-console`. The backend runs official migrations
before starting, after the maintenance fence permits startup. Updater and jobs
hold deployment rights. Each job executes the old complete backend release through
an immutable per-job link, independently of the current updater link.

The installer verifies backend, web, proxied API and updater IPC before reporting
readiness. Fingerprints of configuration files, including the MySQL credential
file when present, block updates if those files change. Their contents are never
returned by the API. Direct executable/source deployments and Windows/macOS use
manual updates; see [database migrations](database-migrations.md) for manual CLI
migration commands.

## Data protection and recovery

SQLite uses a consistent database backup including committed WAL data and associated
business files. MySQL uses a logical backup of the application schema plus business
files. Set `DB_TYPE`, `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD` and
`DB_DATABASE` as appropriate, and explicitly confirm a dedicated schema with
`SYSTEM_UPDATE_MYSQL_EXCLUSIVE_SCHEMA=true`.

The MySQL account needs PROCESS visibility and restore/inspection rights on its
schema, but not global CREATE DATABASE or SUPER. The adapter accepts the application's
InnoDB base-table layout. External writers, unsafe objects, inadequate permissions,
mismatched clients or insufficient storage block execution. Passwords are passed
through protected option files, never command-line arguments. Backups contain
sensitive business data and must remain private.

Preparation downloads and validates targets before downtime. Maintenance blocks
public business requests and background writes. The old services finish pending
work and stop before backup. Target migrations and startup verification run behind
the fence. Failed switching restores the old release and matching data only before
a durable commit decision. After `commit_decided` or `restore_decided`, recovery
never replays an old snapshot over newly accepted writes.

An unprovable recovery remains `recovery_required` with maintenance active. On Linux,
run `sudo rustdesk-console-recover JOB_UUID`; on Docker, use the recorded immutable
backend image and verified mounts with `--system-update-mode=recover --job-id=JOB_UUID`.
Inspect the private journal and retained backup if automatic recovery refuses.
Do not start another job, delete locks, clear maintenance or replace data to hide
an unresolved state.

## Storage and release requirements

The installer budgets block-rounded archive staging and final copies per filesystem,
with 64 MiB headroom. Native preparation validates all archive paths, rejects links
and checks expanded allocation before extraction, retaining 16 MiB release headroom.
Backup/restore capacity depends on database and business-file size. Later I/O errors
use the normal protected recovery path; estimates do not reserve space.

Current releases, backups and unresolved recovery materials are retained. This
version does not automatically prune them. Remove retained materials only after
confirming that no active or unresolved job needs them.

Maintainers supply a tested `peer_version_range` on release dispatch. Docker and
native bundles share a fixed version and source commit. `update-manifest.json` is
published only after all release artifacts are complete and verified. Both manifests
must declare mutual compatibility and matching update/maintenance protocols; a tag
alone cannot authorize an update.

Complete bundles contain build identity, native modules and templates. Linux glibc
SEA builds use the Node 24 Debian Bookworm baseline, rebuild sqlite3 there, and verify
native modules load. Packaging converts internal links to regular files because
installers reject archive links. Release qualification must exercise Docker/Linux
with SQLite/MySQL, recovery, helper replacement, reboot and post-decision writes;
unit tests or unpublished local fixtures do not prove official release execution.
