# RustDesk server management

The Console web application calls `/api/servers`; the NestJS backend authenticates the user and checks global server permissions. The backend talks to a single upstream: the hbbs management API (`/v1`). Relay nodes (hbbr) register with hbbs over an outbound WebSocket and are proxied through it, so Console needs one credential and one URL for the whole deployment. There is no per-node agent, no Docker socket mount, and no shared management volume. Client protocol messages remain compatible. No browser receives server management credentials.

## Compose deployment with the server profile

Use the standard `docker-compose.yml` and `.env` from the Docker installation. To run the RustDesk server (hbbs/hbbr) beside the Console, set `COMPOSE_PROFILES=server` in `.env` together with a public `RUSTDESK_RELAY_ADDRESS` and a `SERVER_MANAGEMENT_TOKEN` (at least 32 random characters; it is passed to the hbbs/hbbr containers as `RD_MANAGEMENT_TOKEN`), then start the deployment:

```sh
docker compose up -d
```

Without `COMPOSE_PROFILES` the deployment keeps the standard three-service layout (backend, web, updater); hbbs/hbbr stay inactive and publish no ports. Keep `COMPOSE_PROFILES` in `.env` rather than in a shell variable so every later `docker compose` invocation — including the updater's — resolves the same service set.

The server profile uses the `databk/rustdesk-server` image and requires a build that includes the management API (any release newer than 1.0.1). It runs exactly two additional containers:

- **hbbs** enables its management API with `RD_MANAGEMENT_BIND`, `RD_MANAGEMENT_TOKEN`, and `RD_MANAGEMENT_DIR` (a persistent directory on its own volume `./data/server`).
- **hbbr** registers with hbbs through `RD_HBBS_API_URL=ws://hbbs:21120/v1/control`, authenticated by the same `RD_MANAGEMENT_TOKEN`. This is a WebSocket endpoint, including its control path. Its identity comes from `RD_RELAY_ID` and its published address from `RD_RELAY_ADDRESS`. Additional relay instances repeat this block with distinct ids; choose ids distinct from the primary node id configured in Console Settings.

Both native services explicitly use `/data` as their working directory and `HOME`. The bind targets stay `/data`: hbbs writes its `id_ed25519`, `id_ed25519.pub` and `db_v2.sqlite3` into `./data/server`; its management JSON remains under `./data/server/management`. hbbr reads `blacklist.txt` and `blocklist.txt` from `./data/server-relay` and persists management JSON in `./data/server-relay/.management`. HOME-relative files, including `.config`, also stay inside each service's data directory. Setting only `RD_MANAGEMENT_DIR` does not relocate keys or the peer database.

**Console** stores its management connection settings (hbbs URL, token, node id and node name) in its database and exposes them to super administrators under Settings. For the Compose server profile set the Console-side URL to `http://hbbs:21120` and use the same token as `SERVER_MANAGEMENT_TOKEN` in `.env`. Management is disabled while the URL is empty. When the token changes in the settings form, update `SERVER_MANAGEMENT_TOKEN` in `.env` and restart hbbs/hbbr so both sides keep matching credentials.

Before enabling remote access, sign in and replace the default `databk` administrator password. Protocol ports are 21115-21119; the management listener 21120 stays inside the Compose network with no host publication. For production, terminate TLS at a host-local reverse proxy in front of the web port and do not publish unencrypted logins; adjust port bindings in `docker-compose.yml` before registering the managed updater, because later Compose changes block the update flow. The server containers write `./data/server` and `./data/server-relay` as root.

Server management is independent of the updater's Docker socket usage in `docker-compose.yml`; the management feature itself mounts nothing. The managed updater never starts, stops or upgrades the hbbs/hbbr services.

## Migrating an existing server profile

Earlier Compose definitions mounted `/data` while the published classic image used `/root` as both its working directory and HOME. Keys, the peer database and relay-local files could therefore remain in the container's writable layer. Recreating those containers before recovery can permanently lose the original identity and registrations. This procedure applies to that stock layout; first inspect any custom `DB_URL`, `RD_MANAGEMENT_DIR`, working directory, HOME, command arguments or mounts and adapt the source paths accordingly.

Use a maintenance window. Do **not** run `up`, `down`, `rm`, an image upgrade or a container prune before copying the old data. Keep the original containers and image until verification is complete. The commands below use a POSIX shell, Docker Compose and Python 3, from the installation directory, with permission to read the data directories. Backups contain private keys, database records and container environment credentials; keep them private.

1. Capture the existing container ids, stop both services without removing them, and copy **both** the old writable directories and the existing mounts into a fresh protected backup directory. A stopped SQLite database must be copied together with any `-wal`, `-shm` or `-journal` sidecars.

   ```sh
   set -eu
   hbbs_id="$(docker compose --profile server ps --all --quiet hbbs)"
   hbbr_id="$(docker compose --profile server ps --all --quiet hbbr)"
   test -n "$hbbs_id" && test -n "$hbbr_id"
   umask 077
   backup="$PWD/server-migration-$(date -u +%Y%m%dT%H%M%SZ)"
   mkdir "$backup"
   mkdir "$backup/hbbs-root" "$backup/hbbs-data" "$backup/hbbr-root" "$backup/hbbr-data"
   docker container inspect "$hbbs_id" "$hbbr_id" > "$backup/containers.json"
   docker compose --profile server stop hbbs hbbr
   test "$(docker container inspect --format '{{.State.Running}}' "$hbbs_id")" = false
   test "$(docker container inspect --format '{{.State.Running}}' "$hbbr_id")" = false
   docker cp "$hbbs_id:/root/." "$backup/hbbs-root"
   docker cp "$hbbs_id:/data/." "$backup/hbbs-data"
   docker cp "$hbbr_id:/root/." "$backup/hbbr-root"
   docker cp "$hbbr_id:/data/." "$backup/hbbr-data"
   ```

2. Recover the native files into their existing bind directories. The following script checks **all** destinations before copying, refuses symlinks and existing destination entries, and verifies the copied key hashes and logical SQLite contents. It leaves the already persisted hbbs `management` directory intact. If it reports a conflict, keep both backups, compare the identities and databases, and explicitly choose the authoritative data before proceeding. Do not overwrite a key pair, merge databases or copy the hbbs database over Console's `./data/rustdesk-console.db`.

   ```sh
   python3 - "$backup" "$PWD/data" <<'PY'
   import hashlib
   import pathlib
   import shutil
   import sqlite3
   import sys
   from contextlib import closing

   backup, data = (pathlib.Path(arg).resolve() for arg in sys.argv[1:])
   required = ('id_ed25519', 'id_ed25519.pub', 'db_v2.sqlite3')
   for name in required:
       if not (backup / 'hbbs-root' / name).is_file():
           raise SystemExit(f'Missing original hbbs file: {name}; inspect the old layout')
   groups = (
       ('hbbs-root', 'server', (*required, 'db_v2.sqlite3-wal',
        'db_v2.sqlite3-shm', 'db_v2.sqlite3-journal', '.config')),
       ('hbbr-root', 'server-relay', ('.management', '.config',
        'blacklist.txt', 'blocklist.txt')),
   )
   copies = []
   for source, target, names in groups:
       directory = data / target
       if directory.is_symlink() or not directory.is_dir():
           raise SystemExit(f'Expected existing bind directory: {directory}')
       for name in names:
           src, dst = backup / source / name, directory / name
           if not src.exists() and not src.is_symlink():
               continue
           if src.is_symlink() or (src.is_dir() and any(p.is_symlink() for p in src.rglob('*'))):
               raise SystemExit(f'Refusing symlink source: {src}')
           if dst.exists() or dst.is_symlink():
               raise SystemExit(f'Conflict, nothing copied: {dst}')
           copies.append((src, dst))

   def sqlite_summary(path):
       with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as db:
           if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
               raise SystemExit(f'SQLite integrity check failed: {path}')
           count = db.execute('SELECT count(*) FROM peer').fetchone()[0]
           digest = hashlib.sha256('\n'.join(db.iterdump()).encode()).hexdigest()
           return count, digest

   original = sqlite_summary(backup / 'hbbs-root' / 'db_v2.sqlite3')
   for src, dst in copies:
       if src.is_dir():
           shutil.copytree(src, dst)
       else:
           shutil.copy2(src, dst)
   for name in ('id_ed25519', 'id_ed25519.pub'):
       old = hashlib.sha256((backup / 'hbbs-root' / name).read_bytes()).hexdigest()
       new = hashlib.sha256((data / 'server' / name).read_bytes()).hexdigest()
       if old != new:
           raise SystemExit(f'Identity verification failed: {name}')
       print(f'{name} SHA-256: {new}')
   if sqlite_summary(data / 'server' / 'db_v2.sqlite3') != original:
       raise SystemExit('Recovered database does not match the original')
   print(f'Verified {original[0]} peer rows; SQLite SHA-256: {original[1]}')
   PY
   ```

   Preserve the complete backup even after copying succeeds. Existing `/data` management JSON remains authoritative in its original mount; do not replace it with unrelated files from `/root`. For a customized layout, recover its actual configuration and file sources separately.

3. With the corrected Compose definition in place, verify it resolves to `working_dir: /data`, `HOME: /data` for both services and `ws://hbbs:21120/v1/control` for hbbr. Only after the key/database checks pass, recreate the two native services:

   ```sh
   docker compose --profile server config
   docker compose --profile server up -d --no-deps --force-recreate hbbs hbbr
   docker compose --profile server logs --tail 100 hbbs hbbr
   ```

   `config` includes interpolated credentials; review it locally and do not paste it into an issue. Before ending maintenance, confirm the public key still matches the backup, original SQLite peer records remain, relay `relay-1` appears in the Services overview, and its configuration can be read and saved. Verify existing ban rules and custom relay configuration as well. If the original containers have already been removed, recovery requires a prior backup; a newly generated key pair cannot restore the former identity.

An already registered managed updater fingerprints the **whole** Compose configuration and its files, including inactive native services. Replacing this definition can therefore produce `CONFIGURATION_DRIFT` and block Console updates. This native-data migration does not change updater registration, and restarting the updater does not accept a changed fingerprint. Review and reconcile that deployment separately before using managed updates; see [Managed system updates](system-update.md) for its installation contract. Preserve updater installation records, job journals, custom overrides and backups; do not disable the check or delete updater state to force an update.

## Permissions and endpoints

All operations require the existing JWT authentication. Super administrators have access; delegated roles may receive these **global**, backend-owned permissions:

| Permission | Capability |
| --- | --- |
| `servers.view` | Nodes, service status, hbbs registrations, hbbr sessions, logs |
| `servers.control` | Start, stop, restart, apply configuration |
| `servers.config` | Read and save configuration |
| `servers.disconnect` | Close an hbbr session |
| `servers.ban` | Read, save and synchronize ban rules |

Every additional permission requires `servers.view`. Mutations are recorded in Console audit with actor, node and operation; configuration values and credentials are excluded.

| Console endpoint | Methods |
| --- | --- |
| `/api/servers` | GET |
| `/api/servers/:node/peers` | GET |
| `/api/servers/:node/sessions` | GET |
| `/api/servers/:node/sessions/:uuid` | DELETE |
| `/api/servers/:node/services/:service/logs?tail=200` | GET |
| `/api/servers/:node/services/:service/config` | GET, PUT |
| `/api/servers/:node/services/:service/:action` | POST (`start`, `stop`, `restart`, `apply`) |
| `/api/servers/:node/bans` | GET, PUT |

The node list combines the primary node (the node id configured in Settings) with the relays registered at hbbs. `start`/`stop` are unsupported by this native management deployment; `restart` asks the target service to exit so its supervisor restarts it, and `apply` restarts only when the configuration reports `pending_restart`.

## Configuration lifecycle

The versioned schema (`rustdesk-server/management-schema.json`) marks each field as `dynamic` or `restart_required`. Dynamic fields apply immediately when saved through `PUT /v1/config`; restart-required fields are persisted and take effect at the next start, so the configuration response reports `pending_restart` until then. `PUT config` accepts `{ "values": { "port": "21116", "relay-servers": "host:21117" } }`; values are strings and omitted fields fall back to deployment arguments and environment. A key shown as `__REDACTED__` preserves the stored key override; without an override it preserves the deployment key. Clearing a key explicitly is a real configuration change. Private-key generation/rotation is not a Console operation.

Listener addresses, database options and infrastructure credentials remain deployment inputs; change them in the Compose definition, not through the runtime settings form. `restart` interrupts sessions of the restarted service.

## Registrations, sessions and bans

Console consumes the hbbs `/v1/events` server-sent event stream (with backoff reconnects) as its live source for relay registrations and relay sessions; when the stream is stale it falls back to direct HTTP queries. hbbs snapshots use its 30-second registration timeout and retain native IDs and base64 device UUID bytes. Console device online state keeps its separate client API heartbeat semantics. Registrations are displayed separately and do not automatically create users/groups or overwrite Console device records.

hbbr reports paired active sessions with UUID, reported target IDs, both addresses, transport, start time and combined traffic in bytes. UUID is an opaque session identifier; it is not the Console device UUID or numeric heartbeat connection ID. Session deletion is routed to the owning relay and returns `closing`; the row disappears after both streams are dropped.

Ban updates accept `{ "device_ids": ["123456"], "ips": ["192.0.2.1"] }`. Console replaces the ban policy on hbbs, which persists it and fans it out to every registered relay (on update and on registration). Device-ID rules reject registration and requests targeting that ID. The ID in a relay request is client-reported; it is not an authenticated identity of both endpoints. IP rules compare both relay endpoints, normalize mapped IPv4 addresses and also block hbbs requests. Already-established relay sessions matching a rule are cancelled. Existing direct connections are outside hbbr and continue to use Console's client heartbeat disconnect mechanism. Servers persist their applied rules for startup, so a Console outage does not erase policy.

## Read-only TCP information

The Network settings card is the final card in the existing Services overview. It is read-only and requires `servers.view`. On the primary node it reads the Console runtime's network scope; relay nodes report their scope as unavailable through the same interface. The value is presented beside its label with a colon. Information popups identify the observed system, deployment and reading scope. Linux reports the current namespace configuration and registered algorithms; Windows reports the current network templates individually. Unresolved system policies, missing permissions or unavailable readers return an explicit reason.

Expanded frame diagnostics reports the **entry sender** and **relay sender** for the authorized caller's own live desktop session. These are actual socket observations, independent of system defaults. The entry is the final sender to the browser; an internal gateway socket behind a reverse proxy is not a substitute. The relay query reverses the bound upstream tuple and is answered from hbbr session state when the tuple matches a registered relay session. The connection reader requires `ss` in the sender's network scope. Missing tools, unreadable namespaces, NAT tuple mismatches and proxy/platform telemetry limitations show **Unable to identify** with the specific reason. No additional service, container, host mount or elevated permission is installed. Ordinary web-client users do not gain server administration access.

Both surfaces include accessible information popups with observed system, deployment and scope, failure reasons and concise algorithm comparisons in all five supported languages. This information does not modify TCP settings, remote display quality or frame-rate limits.

## CI validation

Repository CI provides build, type, lint and regression checks: Console CI runs backend and network tests; web CI builds and runs focused server API/access tests; server CI checks all targets, tests management handlers and builds the managed image.

Console's native server profile job also runs `node --test test/server-profile/compose.integration.mjs` with Node 24 and a Linux Docker engine. It resolves the real Compose file with an isolated test environment, verifies the default three-service layout, and starts only hbbs/hbbr in temporary bind directories with random loopback ports. It checks real relay registration and proxied configuration, anonymous request rejection, native UDP public-key registration, SQLite integrity/records, ban fanout, and key/configuration/list preservation after container recreation. It records the pulled image identity and fails when Docker or the image is unavailable. The test never starts the Console or updater. HOME configuration preservation uses a fixture file; this is not a desktop client handshake or a full Console UI test. Coordinated release validation should still exercise the deployed Console and native servers together.
