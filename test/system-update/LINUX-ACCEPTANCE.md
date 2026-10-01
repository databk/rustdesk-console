# Native Linux acceptance — storage-v3

Current status (2026-09-30): all 24 source-specific storage-v3 cases are complete and pass verify_storage_v3.py --require-complete: twelve MySQL and twelve SQLite. Eleven original receipts remain unchanged; thirteen cases completed in the separately identified reconstructed fixture. Supplemental real updater-startup-failure qualification also passes; it is separate from, and does not change, the24 matrix entries. Older F2 evidence reached 13/24 and is historical, not a pass for storage-v3. The frozen worker/recovery implementation is unchanged; the source epoch changes installer and native archive space budgeting.

Authoritative current index: artifacts/linux/recreated-20260930-r2/storage-v3-matrix-index.json. The original root index retains eleven inherited cases unchanged; new cases carry the reconstructed fixture identity. The host verifier checks result hashes, source snapshot, current artifact identities, restart/reboot assertions and independent MySQL sibling receipts. The 24 cases comprise eight lifecycle/component/reboot scenarios and four actual resource failures for each database.

## Supplemental actual updater startup failure

Job81ed7834-3976-4fca-acb7-9d944c3f3067, installation924b0e0d-71cf-48a5-b1e1-5d2a249904fd, SQLite on real systemd. After target applications reached verify:done, a test-owned runtime ExecStartPre condition genuinely rejected the selected target helper with exit1. The original independent worker retained PID2679/startTicks122233 while the helper was down, then restored the old deployment and data under the same job (rolled_back/restore_decided). After all three services restarted, the old helper executable, original links, business row/file, valid backup and job remained correct. Worker restart count was0. The exact owned fault file was removed; original units and immutable artifacts were untouched.

Result: artifacts/linux/recreated-20260930-r2/linux-sqlite-helper-failure-81ed7834-3976-4fca-acb7-9d944c3f3067-result.json, SHA256ad48f80b41ea1a4f3220236716a49d337892a6ea4d6a587ca38aa387c8fca41a. The fault receipt records actual PID1 failure journal and bounded hold/release timestamps; this is not an observer-thrown synthetic error. Matrix index SHA2567e50804f9e22d2e6d8668f352858e76575d76e39195c0092eeb5f18c90ae665a remains unchanged.

Qualification is Debian12 x64 glibc. ARM64/musl execution remains release-target validation, not a claimed pass. All test releases are local unpublished fixtures. At2026-09-30 08:17UTC the VM was gracefully powered off and dedicated MySQL was already stopped; both exit0/noOOM. All owned test containers are stopped, gates closed, and data/receipts retained. Earlier idle preparation/seed containers exited137 without OOM and are not represented as exit0. No disk expansion, shared restart or global cleanup occurred during this final completion.

## Current storage and resource evidence

- Installer: all 26 tests pass on Linux Python 3.11.2. Download, expansion and final copies budget actual additional allocation with a named 64 MiB reserve; the old fixed 8 GiB floor is removed.
- Runtime: 16 MiB preflight reserve and actual block-rounded expansion checks before writes/maintenance; the old fixed 2 GiB floor is removed. Archive safety caps and dynamic backup budgeting remain.
- Real Linux tmpfs: executable extraction with mode 0755 succeeds on 64 MiB; a 20 MiB payload on 32 MiB is rejected before any extraction writes. These are available-space checks, not minimum VPS sizes.
- Actual default installation succeeds with 8539893760 bytes free, below the previous 8 GiB floor. Published releases, backups and historical evidence are retained.
- Full backend 28 suites / 263 tests, TypeScript and scoped ESLint pass; a subsequently added cleanup-denial regression passes in the four-case preparation suite. No single full 264-test run is claimed.

The reconstructed fixture uses a new, separately identified 16 GiB sparse test disk; no disk expansion occurred. One heavy operation at a time: VM container 2 CPUs / 2048 MiB, guest 1280 MiB, TCG cache 64 MiB, cache=none, reads 16 MiB/s and writes 8 MiB/s. Test scheduling requires 60 GiB host and 2 GiB guest free space, plus measured host/WSL headroom. Unrelated containers do not require an exclusive-engine hold. These are test safeguards, not production installation requirements.

## MySQL fixture interruption and recovery

At 03:31:05 UTC on 2026-09-30 the dedicated MySQL fixture hit its 768 MiB cap during post-terminal restart validation. Job fc29aedf-9139-4a60-bb86-e58cf14795f0 had already reached rolled_back / restore_decided. Its original business row/file, health and unchanged job journal were verified after infrastructure recovery; no snapshot was replayed. This manual reconciliation is excluded from the automatic pass matrix, and the distinct fresh retry passed all original lifecycle and service-restart checks.

The same container, volume, credentials and server UUID (0853d941-bc6e-11f1-b3bf-bec4de07eafd) were retained. Optional performance_schema monitoring was disabled and table_open_cache bounded to 256 in this dedicated test container. CPU 0.5, memory 768 MiB and no additional swap remain unchanged. Initial working memory after restart was about 215 MiB. Before/after each later MySQL case, cgroup memory/OOM counters are recorded; working memory above 85% stops further scheduling. This is a bounded fixture mitigation, not proof of the exact prior allocation cause or a product-default change.

Evidence: storage-v3-mysql-oom-incident.json, storage-v3-mysql-memory-recovery.json, storage-v3-mysql-oom-reconciliation.json and storage-v3-mysql-memory-samples.jsonl.

## Current immutable source epoch

- Source snapshot: 61808216e4fc78850f1fdcec3a49369b0ee1c27f4c4fd117f33cf4d827c05b6c
- Production SEA archive: db74e9aaeb1e45ed234c4e4d5707f7795a1bd9a41911f9a40d811619506af7af
- Fixture backend 1.9.0: f43f24898befc203ae4cdf74b25e429f09cc85c9c28b398228802b5c507e9d89
- Fixture backend 1.9.1: ddfa526c1ca8df5b21546c681fd0456504ce06b3d6c415f563a5b553cac349c2
- Actual exit-42 fixture: 24a39bdd42eb02fcaa725fefad4e610a84ad9955c4e893aab6a9683e4684c581
- Web baseline/target remain the final HEAD-capable pair recorded below.

Artifacts reused verified native dependencies without npm installation or native recompilation. The current production SEA passes its own startup smoke: actual executable readiness, authenticated SQLite business write/read, exit0 and no OOM on0.5CPU/768MiB with network disabled and archive reading capped at4MiB/s. Evidence: artifacts/linux/storage-v3-production-smoke.json. This production smoke is separate from the now-complete updater lifecycle matrix. All fixture releases remain local and unpublished.

## Historical runtime hold and subsequent reconstruction

The following incident records are historical. The user subsequently authorized concurrent bounded operation based on measured headroom. A new fixture, `12c283ae-01bb-4aa0-8429-133d00df775b`, now runs on the new VM volume `console-system-update-test-vm-r2-12c283ae`; its MySQL server UUID is `dd92e88f-bc97-11f1-b9ae-d6c9167966ba`. Original guest data recovery is not claimed. Exclusive-engine scheduling described below is superseded and must not be used as the current execution rule.

Latest05:29 UTC update: after user-confirmed Docker cleanup, both original fixture volumes and containers are absent from the current engine. Earlier retention records are historical. Host result evidence and source/artifacts remain; original guest backups and the interrupted installation are unavailable. The remaining13 cases require a fresh separately identified fixture; no original-state recovery or new pass is claimed. Other owners agreed to a quiet window for bounded reconstruction.

The next restore-resource scenario stopped during its fresh-installation setup after300s; guest reads and Docker inspection also timed out. No restore-resource job was observed and this attempt is not counted. Both original owned fixtures were then stopped successfully (exit0, OOMKilled=false); all data/evidence are retained. The partial installation must be reconciled before a new case.

Other-project containers were subsequently observed on the shared Docker engine. Their presence does not establish the cause of the earlier stall. The driver now refuses a new case when another workload is running, and the same check is required before starting fixtures. No other project is stopped or reconfigured. No driver is active and the scheduling gate is closed. Evidence: storage-v3-runtime-stall.json, storage-v3-contained-stop.json, storage-v3-stopped-fixtures.json and storage-v3-running-inventory.json.

## Historical record retained below

The remaining sections preserve earlier observations and intermediate counts verbatim. They describe their recorded checkpoints, not current progress or current artifact identity. The complete pre-storage-v3 report is also retained in artifacts/linux/linux-acceptance-before-storage-v3.md. Current completion is governed only by the storage-v3 index and verification above.

---

# Linux acceptance continuation

Owner: MAIN (previous deployment workers stopped).
Latest continuation: 2026-09-30 UTC. The user selected local Docker again after
manually restarting Docker Desktop. The retained VM and dedicated MySQL start
under the existing CPU, memory and disk limits, one case at a time, without
rebuilding artifacts. New cases remain gated until interrupted job
`5153395a-3235-4362-9207-f19846cce106` is reconciled. No remote host is in use.
This report distinguishes completed cases, pending native failure cases,
and retained historical failures.

<!-- FINAL_LINUX_RESULTS_START -->
## Final artifact execution results

10 final-input Linux lifecycle cases have passed: SQLite 8/8, MySQL 2/8.
Six MySQL lifecycle/component/reboot cases and eight native resource-fault cases
remain incomplete. The fault harness review is accepted; its actual native
execution is still pending. The interrupted attempts are not passes.

| Database | Scenario | Updated components | Job ID | Verified status | New write retained |
| --- | --- | --- | --- | --- | --- |
| sqlite | startup-failure | backend | `c7d0ec8a-0105-42f0-828e-661d22f7a0a9` | rolled_back | not exercised |
| sqlite | before-commit | backend+web | `942bf798-393e-423e-a1f6-699b839a5dd0` | rolled_back | not exercised |
| sqlite | restore-write | backend+web | `e6fc4ad1-045c-4f08-b9c1-034b3f0c7e29` | rolled_back | yes |
| sqlite | restore-reboot | backend+web | `c8c55375-158c-45f7-ae42-bd9cf01e9856` | rolled_back | yes |
| sqlite | commit-reboot | backend+web | `c98b950e-3eef-45f1-82d1-517bc7ebbdce` | succeeded | yes |
| sqlite | commit-write | backend | `43c6a913-52c0-4d7c-b32e-12f35fbb7e0c` | succeeded | yes |
| sqlite | normal | web | `8b31bf96-94cc-4d8a-987f-53b40b90d400` | succeeded | not exercised |
| sqlite | normal | backend+web | `15093b6d-e686-4288-a50b-50b9524fd31e` | succeeded | not exercised |
| mysql | startup-failure | backend | `a641097e-95a3-42b4-afc0-e2c077f3caeb` | rolled_back | not exercised |
| mysql | before-commit | backend+web | `ac81ba52-8d1c-4ed4-a0c7-17f9edf99eb7` | rolled_back | not exercised |

Actual reboot evidence:

- sqlite restore-reboot: `9807c284-dc92-49bd-9ccb-79f1d4b16ad9` -> `5b7ee175-302c-4a0c-9bd3-0a220f8530c8`; same job `c8c55375-158c-45f7-ae42-bd9cf01e9856`, authenticated database write and fsynced business file retained.
- sqlite commit-reboot: `c5189e0d-3353-4d96-a2f5-8f65191cfee5` -> `49817d77-8d05-4611-afbb-9fe587edd9ff`; same job `c98b950e-3eef-45f1-82d1-517bc7ebbdce`, authenticated database write and fsynced business file retained.

Each deliberate reboot has a host receipt proving the same QEMU container and
disk mounts. Every completed case verifies the unchanged terminal job and
business data again after restarting backend, web and updater.
Machine-readable evidence indexes: artifacts/linux/linux-final-positive-index.json
and artifacts/linux/main-remaining-matrix-index.json. MySQL result entries each
retain an independent sibling-schema receipt.
<!-- FINAL_LINUX_RESULTS_END -->

## Docker transport outage and reconciliation

The host client lost Docker transport while waiting for SQLite backend
commit-write on 2026-09-29. Guest SSH timed out after 60 seconds; independent
Docker inspect/stats calls each timed out after 20 seconds at 18:43-18:44 UTC.
The new-case scheduling gate was closed. MAIN coordinated the user's approved
Docker Desktop restart at approximately 18:46-18:47 UTC. Deployment did not
restart Desktop or change host settings.

The same existing QEMU container and named volume were started after recovery.
Installation `26ac5551-cf73-41f6-9b0c-271a40f90332` retained the exact job
`43c6a913-52c0-4d7c-b32e-12f35fbb7e0c`. Its original result file already
recorded `succeeded` at 18:42:19 UTC, `commit_decided`, an external SIGKILL
at business reopening, `NRestarts=1`, accepted database/file writes retained,
and successful rereads after restarting all three services. The persisted
systemd journal independently records PID 1247 killed at 18:41:51 and the
same job restarted at 18:42:01.

After engine recovery, authenticated database rereads, both business files,
backend/web health and the unchanged job were checked again. Boot ID changed
from `49817d77-8d05-4611-afbb-9fe587edd9ff` to
`4b6aade8-fe02-42ca-802d-a88a74a66e64`; container ID and disk mounts match
the preceding reboot receipt. This is recovered completed guest evidence,
not a pass inferred from an interrupted host client. Evidence files:
`linux-engine-outage-20260929T1844Z.json`,
`linux-engine-recovery-inspection.json`, and
`linux-sqlite-commit-write-43c6a913-52c0-4d7c-b32e-12f35fbb7e0c-engine-recovery.json`.

## Final frozen artifacts

The full canonical production build was repeated from the frozen F2 worker
`2c420fd8e9acee89d482f17c08b82e9a70057cdb3c2e56fc5f87a523c247d356`
and current deployment files in an isolated builder directory. It compiled the
application, rebuilt native SQLite, loaded SQLite/sharp, normalized archive
members, and passed real production executable health. The production executable
contains no fixture seam. Its archive includes the F1 Docker entrypoint
`84b312e4f4410a7ad385775aedcb04ab15238e91a93a2fb3e09e7276f93c9228`.
These checks pass; they do not replace the pending Linux job matrix.

| Final input | SHA-256 |
| --- | --- |
| Complete production glibc SEA | `45263dc3835ca99987c07906381b38bfbe9122f603616cbb54565eedb482ae39` |
| Frozen constructor bundle | `e1d6c06fecfa904fc1764708e299732ea047c876479feeda90887fa4c1191c36` |
| Backend fixture 1.9.0 | `c8732dd28901e5180257bce927b895e62aaa98416c08b732554bc2107d3b0b91` |
| Backend fixture 1.9.1 | `af54a327ae3b34a92e3864351e9a9f89027898af9a697a27eb4e53a60680b640` |
| Backend actual exit-42 fixture 1.9.99 | `b2708dadd94f8538155171594859039c59df1f81c772784ad94b02823a6fa456` |
| HEAD-capable native web baseline 1.6.0 | `45f10e879af8fa9fd7b096221532109b390505e9c40c05f998ed23b765ede224` |
| HEAD-capable native web target 1.6.1 | `bc50083cbc1bc615807009f97cc812f6a8e3384665a545fb3777922ec133bbf8` |

The backend derivatives record exactly one constructor replacement and verify
both fixture markers in the finished SEA. Local production evidence lives in
`artifacts/linux/production-f2-{inputs,archive,smoke}.json` and the full build log.
The source snapshot has 277 files and SHA-256
`73d79c3181519c06c202e9a498962eebef95dfd78b0fd6b016ee17e7e3cfcbf5`.
The final guest payload is prepared locally with SHA-256
`c303f135658ad029ed2a108964b21de575a6d103e3979e056c9026120e17ccab`.
The payload was transferred once. Subsequent helper synchronization does not
rebuild or replace these SEA/web artifacts. The builder is stopped; the existing
1280 MiB guest has exclusive runtime ownership for the remaining Linux cases.

## Historical failed lifecycle and quarantine

Corrected fixture runtime planning passed: plan
`3f3d32d3-117e-4861-9db8-15d87175b798` resolved the local backend 1.9.1 target.
The production Python installer registered installation
`a45bba37-7e02-43ca-b8f2-be12a564365a`; the completed original shell installer was
not rerun.

SQLite startup-failure job `ab52b8ad-afbe-4f71-ad42-42c40e0e9d2b` was accepted at
17:31:35 UTC and ended **recovery_required**, not rolled_back, at 17:33:16 UTC.
The actual target exited 42 according to systemd. Deployment and SQLite/business
data restore completed, but the restored Rust web failed static resource HEAD
verification: `/umi.f423d72e.css` returns GET 200 (1995 bytes), HEAD 404. Backend
and web health both report ready at original versions. The resource exists; this
is a method-routing incompatibility, not evidence of a missing asset.

No durable commit/restore decision exists. The maintenance marker remains
`active:true, allowStart:true`; business requests remain fenced. Evidence:
`artifacts/linux/linux-sqlite-startup-failure-ab52b8ad-afbe-4f71-ad42-42c40e0e9d2b-failure.json`.
The protected recovery export contains the original job, data, backup, config,
maintenance marker and service journal; it is local test evidence, not a
publishable artifact.

Main explicitly authorized quarantine of this exact disposable installation.
After evidence export and unit shutdown it was retained at
`/var/lib/console-system-update-test-history/unresolved-a45bba37-7e02-43ca-b8f2-be12a564365a`.
Its quarantine manifest explicitly records unresolved recovery. No job status,
immutable release directory, backup or fence was rewritten to claim success.

This historical failure preceded the frontend HEAD fix and the separately owned
worker decision re-persistence fix (F2). Both fixes are in the final frozen
inputs above. The failed job and its original artifacts remain preserved;
passing final-input jobs do not rewrite that outcome. Dedicated MySQL
provisioning and sibling baseline collection are prerequisites, not lifecycle
passes.

## Historical fixture-injection blocker

The existing VM was started without changing its disk or named volume. Its live
QEMU command confirms `-m 1280`. The original installer evidence was collected:
installation `b0f74e29-d7cb-4fa3-b174-f920a83422ca`, SQLite, all three units active.
Versions: systemd 252.39, SQLite 3.40.1, MariaDB client 10.11.18.

The actual startup-failure lifecycle was attempted with backend 1.9.99, but
planning returned `CATALOG_UNAVAILABLE` for both components. **No job ID was
accepted.** The installed immutable 1.9.0 fixture binary lacks both
`TEST_FIXTURE_REQUIRED` and `Unknown immutable local fixture` strings and still
uses the production catalog. The fixture builder only intercepted
`./updater/entrypoint`, while compiled `dist/main.js` imports
`./updater/entrypoint.js`. Thus the local catalog and fault observers were never
embedded in these SEA derivatives. The shared constructor fixture source itself
is unchanged; its source hash does not prove injection into the packaged SEA.

`build-fixture-sea.mjs` now matches both import forms and requires exactly one
replacement before constructing a SEA blob. JavaScript syntax validation passes.
Existing 18da0075 / cbf26bd1 archives remain untouched as historical inputs; they
are not valid observer-based Linux acceptance inputs. Main explicitly authorized
a narrow corrected derivative rebuild and immutable re-provisioning after this
defect was demonstrated. A first 1 GiB build exited 137 during postject; exact
cause was not established. Its partial output is preserved. The builder now
stops its esbuild service before SEA injection. With the idle guest gracefully
powered off and only the builder capped at 1536 MiB, both derivatives completed.
The builder is now stopped and the same 1280 MiB guest disk is booted again.
No Docker Desktop restart or host configuration change was performed.

Corrected derivatives use frozen constructor bundle
`47613b3f692976118cdae82529172beceb3985ea36a15e5a7fe03c0a4178643d`
(source `78f17346920b4a32edb12e00d69e87c063fca52e2805fd680218a625723d0f98`).
Both binaries contain the required fixture seam markers. They are retained in
`deployment-artifacts/linux-fixtures-47613-injected`:

| Corrected input | SHA-256 |
| --- | --- |
| Backend fixture 1.9.0 | `f848c85f1f3854c4ac8ab425b7c1474e953dea903bdee6d1bf87027524d0a158` |
| Backend fixture 1.9.1 | `e9dd49467da7ed9bdd66befbde7b56aa517a8826ffc9ca2ab18c3987cde5269b` |

Guest runtime catalog verification passed; lifecycle results are listed above.
Dedicated MySQL `console_linux` and its sibling baseline are provisioned without
rotating any shared Compose credentials.

## Actual installation evidence

The existing disposable VM boots Debian 12 with real PID 1 systemd 252. Its
own QEMU guest uses 1280 MiB and two virtual CPUs. The Docker host configuration
was not changed. The original boot script, disk and named volume are retained.

The real `deployment/install-linux.sh` completed with exit 0 after using apt
to install prerequisites, including libatomic1. It called the production Python
installer with explicit local release/download seams for unpublished artifacts.
No installation record or unit was manually supplied. The installer reported
backend, web, API proxy and updater IPC ready; the wrapper additionally asserted
updater capabilities ready and no update job. The generated guest evidence is
under `/var/lib/console-system-update-test-results`. Export/readback initially failed with Docker engine pipe EOF; the resumed
collector retrieved installation `b0f74e29-d7cb-4fa3-b174-f920a83422ca`. The returned installer output and transport
result are recorded in artifacts/linux/linux-installer-transport-result.json. No Linux lifecycle job had been
accepted at this checkpoint.

## Retained historical immutable inputs

| Input | SHA-256 |
| --- | --- |
| Complete production observer bundle, `backend-linux-x64-glibc-final-observer-v2.tar.gz` | `260fcaeee0b16d2b5de16f82dca29ec53e55b11c02bfbc34cde7a672bfd0157f` |
| Local backend fixture 1.9.0 | `18da0075b18ce41bf69e4d0f7ad6e3e1a1e4c54aee892bf0092c39702a99a14d` |
| Local backend fixture 1.9.1 | `cbf26bd1cb3301df426882a9ab0bc34c8f3b7c495355072723cd7cbd09f9d206` |
| Shared constructor-seam fixture entrypoint | `e1f1145543c013089848d03de5b768779fd15c2c2f2108af26ae34cf16dec018` |
| Native web baseline 1.6.0 | `a518e78b321ee36ebfd5df82a5e6ff1da9400755f3e927d2a1e52d17f8bd2aa9` |
| Native web target 1.6.1 | `6c013a0da3f3ed646c70d7b8a5778df69f591d68cdc6d61e2c662cc3a86c248c` |

Backend bundles are retained in the sibling `deployment-artifacts` directory;
native frontend bundles are in `frontend-evidence`. Old `edef48` and `fbefd210`
exports are historical and must not be substituted. All accepted archive members
are regular files or directories. Fixture packaging uses `--hard-dereference`.
The README installer path `sudo ./deployment/install-linux.sh` exists in the
complete production archive and has executable mode.

These are unpublished fixtures carrying baseline source identities. They do not
prove official release publication. The shared observer waits for external
termination and contains no self-SIGKILL.

## Lifecycle verification contracts

`linux_lifecycle.py` uses actual systemd workers, APIs and database/file rereads.
It records worker PID/SIGKILL, NRestarts, durable decision, original/target
artifact hashes, boot ID and same-job retention after service restart.
The prepared `commit-reboot` and `restore-reboot` scenarios return only after
an authenticated post-decision database write and fsynced business file, leaving
the worker paused and running. `linux_provision.py reboot <jobId>` first fsyncs a
host continuation receipt, requests `systemctl reboot` inside the guest, waits
for QEMU to exit, starts the same container/disk, and resumes verification of the
same job. Passing requires a changed guest boot ID and retention of both writes.
The result table records which of these scenarios have actually completed.

- Both SQLite and dedicated-schema MySQL: normal update and precommit external
  interruption with same-job recovery.
- Actual startup failure: a separate complete 1.9.99 negative bundle executes
  `exit 42`; successful rollback must be observed, not inferred.
- Both durable decisions: accept an authenticated business write and fsync a
  business file after reopening, externally kill the worker, then reread after
  recovery and after backend/web/updater restart.
- Actual backend+web and web-only version targets.
- MySQL uses the strategy API to avoid the recorded baseline user-group partial
  unique-index defect. Its `console_linux` user/schema is separate from Compose
  `console_test`; credentials are retained across installations. Sibling-schema
  contents are compared by the host collector.

Native preflight, backup, archive acquisition and restore-I/O failures require
separate actual evidence for both databases. MAIN owns the new offline
`linux_failures.py` harness; deployment owns its guest execution after handoff.
Until actual results are recorded, these cases remain untested. Docker negative
cases do not count as Linux evidence. An observer-thrown exception alone does
not prove an actual backup/download/restore command failure; local archive read
failure must not be represented as a real HTTP download failure.

## Resume without duplicating completed work

The exclusive Linux slot is currently released. The cooperative
`artifacts/linux/linux-schedule.json` guard gates new cases if MAIN requests
another resource hold; an accepted job's same-job continuation remains allowed.
Use `python -X utf8` on Windows so subprocess stderr uses UTF-8. Do not rebuild
SEA inputs or repeat payload transfer/installation merely to resume.

From `test/system-update`, collect existing evidence first:

```powershell
python -X utf8 linux_provision.py collect
```

Only changed deployment-owned helpers need transfer with
`python -X utf8 linux_provision.py sync`. The guest currently has SQLite
installed. Retarget with `linux_provision.py guest linux_guest target <mode>`
and execute `linux_provision.py guest linux_lifecycle <scenario>` while the
scheduling gate is open. `linux_guest archive` only archives terminal installations and retains
their snapshots, journals, services and configuration under the protected test
history directory. It does not delete evidence or unresolved recovery jobs.

Do not run `environment.py mysql`: that rotates shared Compose credentials.
Use `linux_provision.py mysql` to provision the separate Linux schema once.
Do not operate root-owned browser fixtures or integration-owned Compose helpers.

## Local checks

Python compilation and both build scripts' JavaScript syntax/Prettier checks
pass. The final production SEA build, native module loads, archive inspection
and real executable smoke also pass. The final backend 27 suites/256 tests and
other root source checks are MAIN-owned and were not repeated. Source checks
do not replace real Linux lifecycle evidence.
