# RustDesk server management

The Console web application calls `/api/servers`; the NestJS backend authenticates the user, checks global server permissions, and calls a configured node agent. The agent controls only enrolled hbbs/hbbr containers and calls their private `/v1` management APIs. Client protocol messages remain compatible. No browser receives node or server management credentials.

## Integrated deployment

Place `rustdesk-console`, `rustdesk-console-web`, and `rustdesk-server` beside each other. Initialize the server's submodules. Copy `.env.integrated.example` to a deployment environment file and replace each secret with a different random value (tokens require at least 32 characters). Set the public relay address. The deployment command is:

```sh
docker compose --env-file .env.integrated -f docker-compose.integrated.yml up -d --build
```

Repository CI builds these images before deployment. Console HTTP is bound to `127.0.0.1:21114` for local access and a host-local TLS reverse proxy. Before enabling remote access, sign in locally and replace the default `databk/databk` administrator password. Keep the loopback binding; publish only the proxy HTTPS endpoint with a valid certificate. Proxy all paths, including `/api/`, to `http://127.0.0.1:21114` and preserve the 300-second management request timeout. Do not publish the HTTP login directly. TLS protects login credentials and bearer tokens in transit; password rotation is required separately. Protocol ports are 21115–21119. The agent and server management ports have no host publication. The agent alone has access to the Docker socket; it requires matching `io.rustdesk.console.node` and `io.rustdesk.console.service` labels and configured container names before any Docker operation. Keep this agent on a trusted network. A Docker socket grants host-level control to the agent process. The node token authorizes only the fixed management endpoints; it does not expose arbitrary Docker requests. An agent process compromise is nevertheless a host compromise. A generic socket proxy that allows unrestricted container creation cannot remove that privilege, because creation payloads can request privileged containers and host mounts. Stronger isolation requires a policy-aware broker that validates container ownership and creation payloads, or a dedicated/rootless Docker host.

Existing two-service Console deployments still work without server management. `RUSTDESK_NODES` defaults to an empty list. To enroll a node, configure the backend with a JSON array:

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
