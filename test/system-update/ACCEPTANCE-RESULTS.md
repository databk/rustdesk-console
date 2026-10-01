# Actual Compose acceptance evidence

Updated: 2026-09-29T16:58:10.182746+00:00. Owner: integration. Coordination: console-system-update-acceptance (global).

All entries below are actual applications, Docker services, SQLite/MySQL clients, durable updater journals and API requests. Artifacts are immutable unpublished local fixtures injected through explicit test seams. These results do not prove public official-release availability or complete Linux acceptance.

| Database | Fixture components | Scenario | Result | Job | Evidence |
| --- | --- | --- | --- | --- | --- |
| mysql | backend | before-commit | rolled_back | 8418ee0e-3278-4f71-8932-bf199f265b0e | artifacts/mysql-before-commit-0c887b-result.json |
| mysql | both | normal | succeeded | fa1a633a-a4d0-427e-8d77-a427199f29b2 | artifacts/mysql-both-normal-818141-result.json |
| mysql | backend | commit-write | succeeded | bc4a0e2f-157d-4135-960d-63ff99da6474 | artifacts/mysql-commit-write-150d77-result.json |
| mysql | backend | normal | succeeded | 90a8602d-c7c6-4a34-b36e-6f34bbede4ad | artifacts/mysql-normal-9d71fe-result.json |
| mysql | backend | restore-write | rolled_back | 7815c9d9-a075-419a-8dbc-b7a2ed40f85f | artifacts/mysql-restore-write-33eb9c-result.json |
| mysql | web | normal | succeeded | 06b190d2-75db-4682-b67e-9de46aeebee5 | artifacts/mysql-web-normal-fa28a1-result.json |
| sqlite | backend | after-commit | succeeded | d8c67b22-d3ad-4ff7-85d1-dddf9cb4ee9a | artifacts/sqlite-after-commit-92844e-result.json |
| sqlite | backend | before-commit | rolled_back | 49a7cb1b-582a-4e9a-8879-86e60b87b3a4 | artifacts/sqlite-before-commit-bdc57e-result.json |
| sqlite | both | normal | succeeded | 0cf6b6e0-4359-44d6-863e-caf408497f3a | artifacts/sqlite-both-normal-a5bcae-result.json |
| sqlite | backend | commit-write | succeeded | 2d4aaa01-b60a-439f-9a2b-a8dda34064fc | artifacts/sqlite-commit-write-084b41-result.json |
| sqlite | backend | normal | succeeded | 437aba19-87c6-484c-a4d4-95c4ed69a492 | artifacts/sqlite-normal-e93ec1-result.json |
| sqlite | backend | restore-write | rolled_back | 968c120f-d51a-4ff5-83b0-74b0080a6b76 | artifacts/sqlite-restore-write-69bb4c-result.json |
| sqlite | web | normal | succeeded | 25962da3-07c5-4062-8e93-76002eab3dcb | artifacts/sqlite-web-normal-71d0f7-result.json |

## Verified boundaries

- All recorded cases preserve the same job through backend/web/updater restart and retain their business database row and associated file.
- commit-write and restore-write accept an authenticated real API write after the durable decision and business reopening, then externally kill the exact worker with Docker SIGKILL. Both database and file are reread after recovery and after the three-service restart.
- SQLite writes use the user-group API; MySQL writes use the strategy API. Every MySQL result compares untouched_sibling data before and after.
- Both-component cases update backend 1.9.0 to 1.9.1 and web 1.6.0 to 1.6.1. Web-only cases verify backend/helper image and container identity remain unchanged.
- The two earlier retained SQLite interruption cases are not rerun. Historical namespace-local self-SIGKILL attempts are excluded.
- Exact evidence-file SHA256 values are indexed in artifacts/compose-acceptance-index.json. Later results take immutable artifact identities from the accepted job record, not a mutable fixture catalog.

## Default installation

- SQLite standard Compose registration: deployment-artifacts/bootstrap-live-result.json, installation f3f98cde-a8d6-4383-9c80-d237ff9e94d7; completed by deployment owner.
- MySQL standard Compose registration: artifacts/console-system-update-test-bootstrap-mysql-f284c3-result.json, installation 3f2953bf-4c2d-4458-a5d8-86b7135bfc94. A new dedicated schema/user and configured initial administrator password were used.
- Both start from no installation.json and an empty override, automatically register three services, pin the original images, replace updater through an independent registrar (exit 0), become capable, retain installation identity on helper restart and create no update job.
- Only unpublished catalog/repository/source identity is supplied by a test launcher. Docker inspect/config/image operations, filesystem, database and backup preflight, service replacement, IPC and health are real.

## Diagnoses and excluded runs

- browser-main c95c: immutable plan points to engine-loopback port 36685, which returns connection refused; current registry port 42631 responds. Journal contains prepare:intent only. No main browser fixture mutation occurred. Evidence: artifacts/browser-main-c95c-readonly-diagnosis.json.
- Baseline MySQL user-group defect: the official HEAD partial unique isDefault index becomes a whole-column unique index, rejecting a second nondefault group with HTTP 500. It is recorded in artifacts/mysql-user-group-baseline-defect.json, not silently fixed or counted as an updater failure.
- mysql-normal-3b5bad had a fixture-only worker/web network separation and truthfully ended recovery_required; artifact mysql-network-fixture-defect.json records the actual ENOTFOUND probe. No success is claimed for that run.
- Subsequent fixture-network allocation exhausted Docker address pools before a job was created. New fixtures reuse the labeled task network with unique DNS names. No networks, volumes or prior evidence were deleted; no daemon configuration changed.
- Earlier engine/OOM-interrupted mysql-normal-559f9a and sqlite-after-restore-2afc23 were retained as recovery_required, not passes.

## Source checks and remaining ownership

- Shared observer contains no self-SIGKILL; fixture-entrypoint.ts scoped ESLint and full TypeScript check passed. Python runners parse successfully. The source-only bootstrap launcher passes Node syntax, scoped no-undef/no-unused-vars lint and Prettier.
- Completed test application/helper services are stopped; persistent volumes, journals, snapshots and results remain. Shared registry/MySQL/driver remain available for coordination.
- Linux lifecycle/installer, including both databases and post-decision external interruption, remains deployment-owned and must report its own actual results. This report does not mark the four-combination parent task complete.
- The parent acceptance also retains unrun broader platform/release/failure requirements; these focused results must not be represented as every AC or every failure mode passing.

## Actual resource failures

Recorded 2026-09-29T17:20:22.150926+00:00. Ten additional actual failure cases; these are separate from the 13 lifecycle cases above.

| Database | Failure | Observed outcome | Job | Evidence |
| --- | --- | --- | --- | --- |
| mysql | backup | failed | 14cbdd88-8842-4610-939f-80b59b9a4e93 | artifacts/mysql-f-backup-8870a0-failure.json |
| mysql | preflight | blocked | none (plan blocked) | artifacts/mysql-f-preflight-2ceab0-failure.json |
| mysql | pull | failed | 50f140da-9666-4ec4-abfb-55ea05ea3d92 | artifacts/mysql-f-pull-61ce6b-failure.json |
| mysql | restore | recovery_required | df9b195e-9a29-4588-9cdb-11779dfe52cf | artifacts/mysql-f-restore-3b6509-failure.json |
| mysql | startup | rolled_back | eaf2e7c3-be9e-4d9f-bee4-c17439e65aa9 | artifacts/mysql-f-startup-b72380-failure.json |
| sqlite | backup | failed | d1b6d624-de2e-4189-aaf5-543b3bb60aac | artifacts/sqlite-f-backup-97ad17-failure.json |
| sqlite | preflight | blocked | none (plan blocked) | artifacts/sqlite-f-preflight-3ef8c1-failure.json |
| sqlite | pull | failed | 8390832a-d9eb-4648-a7fa-5be8253c46ff | artifacts/sqlite-f-pull-ea8158-failure.json |
| sqlite | restore | recovery_required | 42a493b2-5d5f-473a-847d-7a4a58c79672 | artifacts/sqlite-f-restore-4575aa-failure.json |
| sqlite | startup | rolled_back | d8b38c9d-2608-4062-863c-be1ad78e1d8a | artifacts/sqlite-f-startup-152b0b-failure.json |

- Preflight: actual SQLite executable unavailable, or real MySQL read-only account lacks restore privileges; no job accepted and no switch.
- Backup-stage failure: after applications stop and backup:intent is durable, an external chmod removes the real client execution permission. Actual OS exec returns 126. Export has not started; this is not evidence of an interrupted mid-stream dump.
- Pull: the immutable requested digest is genuinely absent from the task OCI registry; the journal remains prepare:intent, with no stop or switch.
- Startup: the immutable target lacks its actual Node entrypoint; the captured target container exits 1 with MODULE_NOT_FOUND. Real verification fails and data/application restoration succeeds.
- Restore: a valid backup completes, then the failed target triggers restoration onto an actual read-only filesystem. EROFS is independently probed; restore_data remains intent, recovery_required and the maintenance fence persist, including the same job after helper restart.
- Every non-restore-failure case rereads the authenticated business API row and data file. Every MySQL case compares the untouched sibling schema.
- No constructed exception or mock counts as these failures. Exact evidence hashes are in artifacts/compose-failure-index.json. Completed fixture services are stopped; artifacts and volumes remain.
- Excluded additional observations: the initial long fixture DNS label exceeded 63 bytes before any job; a first startup run completed rollback before the runner captured its removed target container. Neither is counted. The runner now bounds DNS names and pauses only to capture the actual process/resource failure before continuing real I/O.
- These negative cases use observer fixture image IDs 89615f5985471a8ebc8ed28bf264d4aa7e6fb8d6ebc1a7fc7f94ecadf9c2d34d / 9ac9fbaa72c16ba160be97e7bd5ce5dc419844e4019eab37e1b366190c55c148 and broken target b1f72a83fc9cf363314324a291c2414f8a6b0f3cf7d4aa2c2b712692b094eefc. They do not retroactively change earlier lifecycle artifact identities.


## Post-F1/F2 final production qualification

Recorded 2026-09-29T18:32:34.175662+00:00. Owner: integration; coordination: console-system-update-repair (global). This is a NEW final-artifact result section. The 13 lifecycle and 10 fault results above remain historical, with their original bytes and hashes unchanged.

### Final artifact identities

| Role | Immutable local image ID |
| --- | --- |
| Production Dockerfile output | sha256:5abbe6e46c760eef3aa1aac9ae2b2a19e863b467a5dc4335c6407d8f3d361e92 |
| Observer baseline 1.9.0 | sha256:708737910ab0fe07b8d32de0888b5b01c29833afe3f137592c295263daef3210 |
| Observer target 1.9.1 | sha256:655ed5a1b12ec02b232fe70ee555073ef4a96cc987eade1b73cebb83e34e79ef |
| Final web baseline 1.6.0 | sha256:b6e5779e1af0c4b81c080ef365584814c7b6832650ca1124f4b94e5903bc73ee |
| Final web target 1.6.1 | sha256:0563f70c4f11a386c732e44b4ae3107c1af2b9059e695ed5bafc6df8634dd915 |

- Official-main base commit: d07e8bcc7640c098dbd168ee73d6b228f8c7744c; uncommitted task source-content hash: f60c1965cdd81b04c0432419ec03350047546609f07681fce18392709963d69d. These are unpublished qualification images, not claims of an official release.
- Production used the normal Dockerfile and dependency cache. Both observer images derive from this exact production image; new tags and a separate artifacts/post-f1-f2/local-oci-fixtures.json preserve the historical catalog and images.
- Final worker source SHA256: 2c420fd8e9acee89d482f17c08b82e9a70057cdb3c2e56fc5f87a523c247d356. Compiled worker SHA256: 59a331fbe4dc3a8e2a4f4ede5420906915c4bd71f0ea45b85da9c1c0c1c9f7a1, identical to frozen host dist; image inspection confirms decision save before verification/opening.
- F1 entrypoint SHA256: 84b312e4f4410a7ad385775aedcb04ab15238e91a93a2fb3e09e7276f93c9228, verified inside production and both derivatives.
- Handed-off fixture CJS SHA256: e1d6c06fecfa904fc1764708e299732ea047c876479feeda90887fa4c1191c36, consumed read-only and verified inside both derivatives. Neither the shared bundle nor its TypeScript source was regenerated or changed.

### Actual final-runtime cases

| Database | Scenario | Outcome | Same job | Evidence |
| --- | --- | --- | --- | --- |
| sqlite | commit-write | succeeded | c4d916ee-e06f-4aae-b126-9144893fb6a8 | artifacts/sqlite-commit-write-439d98-result.json |
| sqlite | restore-write | rolled_back | c101dfbd-cd19-4b40-9ad7-78a777d137ba | artifacts/sqlite-rwrite-0f429e-result.json |
| mysql | commit-write | succeeded | 00c39765-aa77-4736-8016-ece708a0f1c4 | artifacts/mysql-cwrite-854ab1-result.json |
| mysql | restore-write | rolled_back | 9dfeb3d6-922c-4f7e-b407-c80d3c28e203 | artifacts/mysql-rwrite-0d2687-result.json |

- All four accept an authenticated real business API write after the durable commit/restore decision and business reopening, then externally SIGKILL the exact independent worker. Container identity, pre-kill PID/start time and changed start time prove same-container/same-job recovery. The database row and associated file survive recovery and a subsequent backend/web/updater restart.
- Both MySQL cases compare the untouched sibling-schema sentinel. Restore cases actually restore the snapshot before reopening; their later accepted writes survive, proving recovery did not replay that older snapshot.

### Final production default registration

| Database | Installation ID | Evidence |
| --- | --- | --- |
| sqlite | 1008d3cc-1dd1-4222-bf5a-5a992cac659e | artifacts/console-system-update-test-bootstrap-sqlite-b3ff25-result.json |
| mysql | bcb5e1f3-1153-4c6b-96ad-535529ca13c9 | artifacts/console-system-update-test-bootstrap-mysql-b1af66-result.json |

- Both start with no installation record and an empty override, use the standard three roles, pin the original production/web image identities, complete the independent registrar with exit 0, become ready, retain installation identity after helper restart and create no automatic update job. MySQL also preserves the sibling schema.
- Backend and helper use the exact production image listed above. The launcher imports the registration module packaged in that image. Only the helper mounts the reviewed local catalog CJS read-only to qualify unpublished identity through the existing test seam. Docker/Compose, registration, health, filesystem, authentication, IPC and backup preflight remain real operations.

### Checks, exclusions and resource handoff

- The initial SQLite restore invocation hit the existing DNS-name-length guard before resources or a job existed. Only test-case slugs were shortened. Its retained log is excluded from passed-case counts.
- During MySQL commit-write a separate Docker stats probe timed out after 35 seconds while Linux was active. The original runner completed every actual assertion and exited 0; no timeout/policy was weakened, no duplicate job was created and no Desktop restart occurred. Main accepted this result with the slowdown note. Remaining cases ran after the guest was powered off.
- Python AST checks pass for all three changed runners. Bootstrap launcher Node syntax, Prettier and scoped standard JS ESLint pass. Fixture Docker builds pass. No TypeScript/runtime source changed in this integration phase; accepted frozen-source typecheck/unit results are retained, not relabeled as new runs.
- All 24 owned application/helper/worker/registrar containers are stopped and none reports OOMKilled. Shared registry/MySQL/driver remain available. Data, journals, snapshots, volumes and old images are retained. Heavy build and exclusive runtime slots have been released to main.
- No host dist cleanup/rebuild, original-workspace product edit, Git operation, host setting change or production-resource mutation occurred. Historical indexes and all 23 referenced JSON files were rehashed unchanged. Broader Linux/platform/public-release qualification remains with its owners.
- Final index: artifacts/post-f1-f2/final-acceptance-index.json; SHA256 085511fb580eb8eca403809576317d289899109e00f39b1b8de89893db083b79.


## Final local qualification handoff — 2026-09-30

The separate native storage-v3 matrix now passes24/24 on Debian12 x64 glibc with real systemd, twelve cases per database. Its supplemental actual helper-startup-failure case also rolls back the same job, preserves the independent worker and restores old helper/data/backup across service restart. See LINUX-ACCEPTANCE.md for exact artifacts, fixture identities and receipts. This closes the outstanding local native runtime matrix; it does not relabel the historical Docker epochs above or claim ARM64/musl runtime qualification. Final native VM/MySQL are stopped and no owned test container is running. Official release/manifest execution and unqualified release targets remain publication-validation work.
