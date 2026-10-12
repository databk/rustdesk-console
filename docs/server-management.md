# RustDesk server management

The Console web application calls `/api/servers`; the NestJS backend authenticates the user and checks global server permissions. An explicitly enabled local adapter reuses the management core inside Console without an additional listener, container or host service. Existing remote node agents remain supported. The core controls only enrolled hbbs/hbbr containers and calls their private `/v1` management APIs. Client protocol messages remain compatible. No browser receives node or server management credentials.

## Integrated deployment

Place `rustdesk-console`, `rustdesk-console-web`, and `rustdesk-server` beside each other. Initialize the server's submodules. Copy `.env.integrated.example` to a deployment environment file and replace each secret with a different random value (tokens require at least 32 characters). Set the public relay address. The deployment command is:

```sh
docker compose --env-file .env.integrated -f docker-compose.integrated.yml up -d --build
```

Repository CI builds these images before deployment. Console HTTP is bound to `127.0.0.1:21114` for local access and a host-local TLS reverse proxy. Before enabling remote access, sign in locally and replace the default `databk/databk` administrator password. Keep the loopback binding; publish only the proxy HTTPS endpoint with a valid certificate. Proxy all paths, including `/api/`, to `http://127.0.0.1:21114` and preserve the 300-second management request timeout. Do not publish the HTTP login directly. TLS protects login credentials and bearer tokens in transit; password rotation is required separately. Protocol ports are 21115–21119. Native management ports have no host publication.

The integrated template runs exactly four containers. `SERVER_MANAGEMENT_LOCAL=1` enables the in-process adapter; `SERVER_MANAGEMENT_TOKEN` authenticates its requests to both native servers. A shared `MANAGEMENT_DIR` persists configurations and bans. `NODE_ID` defaults to `local`, and must match the enrolled containers' labels. `HBBS_CONTAINER`, `HBBR_CONTAINER`, `HBBS_MANAGEMENT_URL`, and `HBBR_MANAGEMENT_URL` can adapt an existing deployment's names without changing its public ports or device keys. This local node must have an ID distinct from any remote node.

Console has access to the Docker socket only when local management is enabled and the deployment mounts it. The driver requires matching `io.rustdesk.console.node` and `io.rustdesk.console.service` labels and configured container names before any Docker operation. No browser endpoint accepts arbitrary Docker requests. A Docker socket nevertheless grants host-level privileges to its holder, so a compromise of the Console process can compromise the host. For remote-node agents the same limitation applies to the agent process instead. A generic socket proxy permitting unrestricted container creation cannot remove this privilege; creation payloads can request privileged containers and host mounts. Stronger isolation requires a policy-aware broker or a dedicated/rootless Docker host.

Existing two-service Console deployments still work without server management. Local management is disabled by default, and `RUSTDESK_NODES` defaults to an empty list. To enroll an optional remote node, configure the backend with a JSON array:

```json
[{"id":"local","name":"Local RustDesk","url":"http://rustdesk-agent:3001","token":"a-random-token-at-least-32-characters"}]
```

IDs must be unique and match the agent's `NODE_ID` and container labels. URLs must be HTTP(S) origins without paths or credentials. Additional nodes use the same interface; deploy one agent per Docker host and use HTTPS when crossing hosts. Backend environment changes require a backend restart. This first version provides environment-based enrollment, not a browser credential editor.

## Permissions and endpoints

All operations require the existing JWT authentication. Super administrators have access; delegated roles may receive these **global**, backend-owned permissions:

| Permission | Capability |
| --- | --- |
| `servers.view` | Nodes, service status, hbbs registrations, hbbr sessions, logs |
| `servers.control` | Start, stop, restart, apply configuration |
| `servers.config` | Read and save configuration |
| `servers.disconnect` | Close an hbbr session |
| `servers.ban` | Read, save and synchronize ban rules |

Every additional permission requires `servers.view`. Existing `devices.*` permissions do not grant node-wide operations. Mutations are recorded in Console audit with actor, node and operation; configuration values and credentials are excluded.

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

Node and server protocols carry `api_version: 1`. hbbs exposes status/config/peers/bans. hbbr exposes status/config/sessions/bans and session deletion. APIs require independent Bearer credentials. Server APIs are opt-in through `RD_MANAGEMENT_BIND`, `RD_MANAGEMENT_TOKEN`, and `RD_MANAGEMENT_DIR`; existing deployments have no new listener by default.

## Configuration lifecycle

Opt-in in-process management (`SERVER_MANAGEMENT_LOCAL=1`) requires the Docker
socket mounted in Console. The image keeps UID 1000 and uses the socket's group
as its runtime group; it fails at startup if that socket is missing. Docker socket
access grants host-level administration capability, so enable this mode only for
a trusted Console deployment. Read-only local TCP information does not need it.

The schema lists effective service settings, including deprecated hbbs settings, database options and hbbr bandwidth controls. It is versioned in `agent/schema.json` and `rustdesk-server/management-schema.json`. Keep the two copies identical when changing the contract. Configuration source paths (`--config` and `.env`) are deployment inputs; their effective setting values can be overridden directly. Infrastructure credentials and API listener addresses remain deployment-only.

`PUT config` accepts `{ "values": { "port": "21116", "relay-servers": "host:21117" } }`. Values are strings; omitted fields fall back to deployment arguments/environment. Saving persists a complete override document; it does **not** change the running process. Managed overrides take priority over CLI, config files and environment at the next start. A key shown as `__REDACTED__` preserves the stored key override; without an override it preserves the deployment key. Clearing a key explicitly is a real configuration change. Private-key generation/rotation is not a new Console operation.

Start, restart, and apply load the saved overrides. Apply checks the authenticated management API, verifies the effective listener port against the container bindings, and synchronizes bans before reporting success. Failure restores the last applied override and attempts to restore the old running/stopped state. Listener port changes recreate the container, remap its container-side protocol ports while retaining the published **host** ports, image, mounts, resources and network aliases, and retain the old container until readiness succeeds. A cleanup failure may leave a stopped rollback container for operator cleanup. Rollback attempts every independent recovery step even if an earlier step fails, records failed steps in agent logs, and retains the original operation failure. The applied-state checkpoint is persisted before deleting the rollback container; checkpoint failure triggers the same runtime rollback as readiness failure. Data volumes are never deleted. Applying or stopping a service interrupts its sessions.

The immutable `io.rustdesk.console.deployment-port` label records the original startup listener port; removing a saved port override restores that port. Set this label to the CLI/environment startup port when enrolling an existing custom-port deployment. Without this label the agent uses the standard service port, and readiness rejects any mismatch.

Console becomes the runtime authority for managed listener ports. A later `docker compose up` can recreate a container from the original Compose definition; align the Compose port bindings and port label with Console's applied configuration before doing that. For changing externally published host ports or images, update the deployment manifest rather than the runtime settings form.

## Registrations, sessions and bans

hbbs snapshots use its 30-second registration timeout and retain native IDs and base64 device UUID bytes. Console device online state keeps its separate client API heartbeat semantics. Registrations are displayed separately and do not automatically create users/groups or overwrite Console device records.

hbbr reports paired active sessions with UUID, reported target IDs, both addresses, transport, start time and combined traffic in bytes. UUID is an opaque session identifier; it is not the Console device UUID or numeric heartbeat connection ID. Session deletion returns `closing`, and the row disappears after both streams are dropped. The cancellation wraps the whole relay task, including waits in bandwidth limiters.

Ban updates accept `{ "device_ids": ["123456"], "ips": ["192.0.2.1"] }`. Device-ID rules reject registration and requests targeting that ID. The ID in a relay request is client-reported; it is not an authenticated identity of both endpoints. IP rules compare both relay endpoints, normalize mapped IPv4 addresses and also block hbbs requests. Already-established relay sessions matching a rule are cancelled. Existing direct connections are outside hbbr and continue to use Console's client heartbeat disconnect mechanism.

The agent persists desired rules and reports per-service `applied` or `pending` synchronization. It retries every 10 seconds and before marking a restarted service healthy. Servers persist their last applied rules for startup, so an agent outage does not erase policy. Server peers/register/relay routes enforce these rules independently of Console's database device status. The existing hbbr `blacklist` remains a bandwidth limiter; it is not the new persistent ban policy.

## CI validation

The existing repository CI provides permanent build, type, lint and regression checks for this feature. Console CI includes backend and Node agent tests; web CI builds and runs focused server API/access tests; server CI checks all targets, tests management handlers and builds the managed image. Per-repository CI does not establish full-stack interoperability. Coordinated release validation should exercise the deployed Console, agent and native servers together.


### Interrupted operations

Rollback covers errors returned while the agent process remains alive. Container replacement is not a durable transaction across Docker and filesystem state. If the agent or host stops during stop/rename/disconnect/create, inspect the enrolled container and any `<service>-rollback-<uuid>` container before repeating an apply. Preserve both containers and management files until the active listener, container labels, host port mappings and saved/applied configuration agree. Restore the original container name and network aliases, restore `<service>-config.json` from the last verified `<service>-applied.json`, and start that container if it was previously running. Do not delete the backup or rewrite the applied checkpoint without verifying the service. Automatic recovery of interrupted replacements requires a durable transition journal and is outside this first deployment's guarantees.

## Read-only TCP information

The Network settings card is the final card in the existing Services overview. It is read-only and requires `servers.view`; it has no algorithm selector, apply operation, saved preference or host helper. With no management node or with the integrated local node, it reads the Console runtime's network scope. With a registered remote node, it reads that node's scope. The value is presented beside its label with a colon. Information popups identify the observed system, deployment and reading scope; bridge/host classification is omitted because it is unnecessary for reading the algorithm. Container observations are never represented as physical-host settings. Linux reports the current namespace configuration and registered algorithms; Windows reports the current network templates individually. Unresolved system policies, missing permissions or unavailable readers return an explicit reason. Management tabs remain visible when no node is enrolled, with an explicit unavailable state rather than a stopped-service claim.

Expanded frame diagnostics reports the **entry sender** and **relay sender** for the authorized caller's own live desktop session. These are actual socket observations, independent of system defaults. The entry is the final sender to the browser; an internal gateway socket behind a reverse proxy is not a substitute. The relay query reverses the bound upstream tuple and requires an hbbr-owned sending socket. An already enrolled agent can perform a fixed read-only query in its enrolled hbbr container, without accepting arbitrary commands or container IDs. Its optional association is `WEB_CLIENT_TCP_RELAY_NODE_ID`; an unrelated sole node is never automatically chosen. The connection reader requires `ss` in the sender's network scope. Missing tools, unreadable namespaces, NAT tuple mismatches and proxy/platform telemetry limitations show **Unable to identify** with the specific reason. No additional service, container, host mount or elevated permission is installed. Ordinary web-client users do not gain server administration access.

Both surfaces include accessible information popups with observed system, deployment and scope, failure reasons and concise algorithm comparisons in all five supported languages. Registered lists exclude unloaded modules; fallback tables are explicitly labelled as common algorithms with local support unconfirmed. This information does not modify TCP settings, remote display quality or frame-rate limits.
