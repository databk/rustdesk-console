# System update integration acceptance

This directory is deliberately separate from the default unit suite. Real
acceptance requires Docker/SQLite, Docker/MySQL, standard Linux binaries/SQLite,
and standard Linux binaries/MySQL. A unit-test substitute for systemd or a
locally built fixture is never evidence of published official release acceptance.

## Isolated real systemd environment

The VM runs QEMU TCG as UID 10001 in an ordinary Docker container, with no
privileged mode, host Docker socket, cgroup bind, KVM device, or host service
changes. Only a task-owned named volume stores its guest disk and SSH key.
Debian cloud-image SHA-512 is checked against its official HTTPS checksum list.
Record the actual base image and cloud-image hashes with each run.

```powershell
docker build -t console-system-update-test-vm:local test/system-update/vm
docker volume create --label console-system-update-test=true console-system-update-test-vm
docker network create --label console-system-update-test=true console-system-update-test
docker run -d --name console-system-update-test-vm --label console-system-update-test=true --network console-system-update-test --cap-drop ALL --security-opt no-new-privileges --memory 4g --cpus 3 --mount type=volume,source=console-system-update-test-vm,target=/vm console-system-update-test-vm:local
docker exec console-system-update-test-vm ssh -i /vm/id_ed25519 -p 2222 -o StrictHostKeyChecking=accept-new tester@127.0.0.1 "ps -p 1 -o comm=; systemctl is-system-running; systemd --version"
```

Ports are not published on the Windows host. The guest SSH key remains in the
isolated volume. After a guest reboot exits QEMU, restart only this named VM
container. Do not run broad Docker cleanup commands.

## Compose lifecycle runner

`compose_fixture.py` stores installations and journals in the labeled
`console-system-update-test-fixtures` volume. Only one application fixture runs
at a time; completed cases stop their services without deleting data or volumes.
The shared MySQL server uses a dedicated Console schema plus an untouched sibling
sentinel. Do not rerun `environment.py mysql` against an active fixture: it changes
the test account password.

```powershell
python test/system-update/lifecycle.py --database sqlite --scenario commit-write
python test/system-update/lifecycle.py --database sqlite --scenario restore-write
python test/system-update/lifecycle.py --database mysql --scenario normal
python test/system-update/lifecycle.py --database mysql --scenario before-commit
python test/system-update/lifecycle.py --database mysql --scenario commit-write
python test/system-update/lifecycle.py --database mysql --scenario restore-write
python test/system-update/lifecycle.py --database sqlite --scenario normal --components both
python test/system-update/lifecycle.py --database mysql --scenario normal --components web
```

The observer only records a durable boundary and pauses. The runner issues the
external `docker kill --signal KILL` for that exact worker. A self-issued signal
is not crash evidence. Write scenarios first assert the durable decision, accept
a real authorized business API write, then terminate the worker. The runner reads
the database row and business file both after same-job recovery and after
restarting backend, web, and updater. MySQL cases also compare the sibling schema
sentinel.

The optional `--components` argument selects an unpublished test catalog, not an
API input or a product feature. The default changes only backend 1.9.0 to 1.9.1.
`both` additionally changes web 1.6.0 to 1.6.1; `web` leaves the backend and helper
at their original version. Web-only assertions compare their actual container
and image identities, proving that unchanged components were not recreated.
These variants use the frontend owner's independently built, versioned assets.
The shared task network uses unique container names for health and proxy targets
so retained fixtures do not consume additional Docker subnets.

The official baseline user-group entity uses a SQLite partial unique index that
MySQL treats as whole-column uniqueness. Consequently a second nondefault group
returns HTTP 500 on that baseline. MySQL lifecycle sentinels use the existing
strategy-create/list API; this does not fix or hide the separate baseline defect.
The captured failure is retained in `artifacts/mysql-user-group-baseline-defect.json`.

The runner writes redacted result JSON under ignored `artifacts/`. Archive the
results with their immutable image references. A terminal assertion, timeout, or
unavailable engine is a failed or incomplete case, never a pass. These locally
published test artifacts exercise actual applications, Docker, database clients,
and recovery; they do not prove public official-release availability.

## Default MySQL bootstrap

`python test/system-update/compose_bootstrap_mysql.py` starts the standard three
service roles with an empty installation and override. It creates a new dedicated
test schema/user and supplies the initial administrator password through the
standard configuration. The companion `compose-bootstrap.fixture.mjs` injects
only unpublished release identity into the actual registration function; it does
not mock Docker, services, files, health, IPC or database backup preflight.
Registration, immutable-image pinning, independent helper replacement, restart
identity and absence of an automatically started job are asserted. All test data
and generated credentials remain in ignored artifacts or the protected volume.

## Actual resource failure cases

After building the observer fixtures and publishing their immutable references:

~~~powershell
docker build -f test/system-update/broken-target.Dockerfile -t console-system-update-test-backend:broken-target .
python test/system-update/failure_lifecycle.py --publish-target
python -X utf8 test/system-update/failure_lifecycle.py --database sqlite
python -X utf8 test/system-update/failure_lifecycle.py --database mysql
~~~

The cases run sequentially and stop completed application services. Preflight
uses a real unavailable SQLite executable or the real MySQL read-only account.
Backup failure removes the actual client executable permission after the durable
backup intent and application stop, then lets the real adapter run. Pull failure
requests a genuinely absent digest from the task registry. Startup failure uses
an immutable image whose actual Node entrypoint is absent. Restore failure uses
a read-only data mount, so actual filesystem writes fail after a valid backup.
The observer only pauses for external observation/resource changes and resumes;
no injected exception counts as any of these resource failures.

Assertions cover no switch after preparation/backup failure, real process exit
and successful rollback, or recovery_required with the maintenance fence and
same job after helper restart. Every MySQL case checks the untouched sibling
schema. Results are redacted *-failure.json files. Timeouts, observation races,
and engine failures remain incomplete evidence and must never count as passes.

Recorded case boundaries, exclusions and remaining ownership are listed in
`ACCEPTANCE-RESULTS.md`; exact redacted evidence hashes are in
`artifacts/compose-acceptance-index.json`.

## Final-runtime qualification after F1/F2

Preserve the original lifecycle and failure indexes. Publish the final production
image, its separately versioned observer derivatives, and the frontend owner's
final images with new tags and an explicitly selected catalog:

```powershell
python -B test/system-update/compose_fixture.py publish --sources test/system-update/artifacts/post-f1-f2/image-sources.json --fixture-catalog test/system-update/artifacts/post-f1-f2/local-oci-fixtures.json --tag-suffix post-f1-f2
python -B test/system-update/lifecycle.py --database sqlite --scenario commit-write --fixture-catalog test/system-update/artifacts/post-f1-f2/local-oci-fixtures.json
python -B test/system-update/lifecycle.py --database sqlite --scenario restore-write --fixture-catalog test/system-update/artifacts/post-f1-f2/local-oci-fixtures.json
python -B test/system-update/lifecycle.py --database mysql --scenario commit-write --fixture-catalog test/system-update/artifacts/post-f1-f2/local-oci-fixtures.json
python -B test/system-update/lifecycle.py --database mysql --scenario restore-write --fixture-catalog test/system-update/artifacts/post-f1-f2/local-oci-fixtures.json
python -B test/system-update/compose_bootstrap_mysql.py --database sqlite --production --fixture-catalog test/system-update/artifacts/post-f1-f2/local-oci-fixtures.json --fixture-entrypoint test/system-update/artifacts/fixture-entrypoint.cjs
python -B test/system-update/compose_bootstrap_mysql.py --database mysql --production --fixture-catalog test/system-update/artifacts/post-f1-f2/local-oci-fixtures.json --fixture-entrypoint test/system-update/artifacts/fixture-entrypoint.cjs
```

The source mapping accepts immutable local image IDs only. Its `production`
entry identifies the unmodified production Dockerfile output. Registration uses
that exact image for the application and helper and imports the registration
module packaged in the image. The helper alone mounts the reviewed local catalog
entrypoint read-only so unpublished artifact identities can be qualified. This is
an explicit test seam, not official release provenance or a production setting.

Run one case at a time after the build coordinator releases its slot. Application
services have memory/CPU limits; the lifecycle runner also bounds the exact job
worker and records its external termination, container identity, and changed
start timestamp on same-job recovery. New result JSON records the separate
catalog hash. Append final results to `ACCEPTANCE-RESULTS.md`; never relabel the
earlier 13 lifecycle or 10 failure results as tests of the new artifacts.
