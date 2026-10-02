# RustDesk server management

The Console web application calls `/api/servers`; the NestJS backend authenticates the user, checks global server permissions, and calls a configured node agent. The agent controls only enrolled hbbs/hbbr containers and calls their private `/v1` management APIs. Client protocol messages remain compatible. No browser receives node or server management credentials.

## Integrated deployment

Place `rustdesk-console`, `rustdesk-console-web`, and `rustdesk-server` beside each other. Initialize the server's submodules. Copy `.env.integrated.example` to a deployment environment file and replace each secret with a different random value (tokens require at least 32 characters). Set the public relay address. The deployment command is:

```sh
docker compose --env-file .env.integrated -f docker-compose.integrated.yml up -d --build
```

Build and exercise these images in CI before deploying. Console is published on port 21114. Protocol ports are 21115–21119. The agent and server management ports have no host publication. The agent alone has access to the Docker socket; it requires matching `io.rustdesk.console.node` and `io.rustdesk.console.service` labels and configured container names before any Docker operation. Keep this agent on a trusted network. A Docker socket grants host-level control to the agent process.

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

The schema lists effective service settings, including deprecated hbbs settings, database options and hbbr bandwidth controls. It is versioned in `agent/schema.json` and `rustdesk-server/management-schema.json`; CI integration checks keep the copies identical. Configuration source paths (`--config` and `.env`) are deployment inputs; their effective setting values can be overridden directly. Infrastructure credentials and API listener addresses remain deployment-only.

`PUT config` accepts `{ "values": { "port": "21116", "relay-servers": "host:21117" } }`. Values are strings; omitted fields fall back to deployment arguments/environment. Saving persists a complete override document; it does **not** change the running process. Managed overrides take priority over CLI, config files and environment at the next start. A key shown as `__REDACTED__` preserves the stored key override; without an override it preserves the deployment key. Clearing a key explicitly is a real configuration change. Private-key generation/rotation is not a new Console operation.

Start, restart, and apply load the saved overrides. Apply checks the authenticated management API and synchronizes bans before reporting success. Failure restores the last applied override and attempts to restore the old running/stopped state. Listener port changes recreate the container, remap its container-side protocol ports while retaining the published **host** ports, image, mounts, resources and network aliases, and retain the old container until readiness succeeds. A cleanup failure may leave a stopped rollback container for operator cleanup. Data volumes are never deleted. Applying or stopping a service interrupts its sessions.

Console becomes the runtime authority for managed listener ports. A later `docker compose up` can recreate a container from the original Compose definition; align the Compose port bindings and port label with Console's applied configuration before doing that. For changing externally published host ports or images, update the deployment manifest rather than the runtime settings form.

## Registrations, sessions and bans

hbbs snapshots use its 30-second registration timeout and retain native IDs and base64 device UUID bytes. Console device online state keeps its separate client API heartbeat semantics. Registrations are displayed separately and do not automatically create users/groups or overwrite Console device records.

hbbr reports paired active sessions with UUID, reported target IDs, both addresses, transport, start time and combined traffic in bytes. UUID is an opaque session identifier; it is not the Console device UUID or numeric heartbeat connection ID. Session deletion returns `closing`, and the row disappears after both streams are dropped. The cancellation wraps the whole relay task, including waits in bandwidth limiters.

Ban updates accept `{ "device_ids": ["123456"], "ips": ["192.0.2.1"] }`. Device-ID rules reject registration and requests targeting that ID. The ID in a relay request is client-reported; it is not an authenticated identity of both endpoints. IP rules compare both relay endpoints, normalize mapped IPv4 addresses and also block hbbs requests. Already-established relay sessions matching a rule are cancelled. Existing direct connections are outside hbbr and continue to use Console's client heartbeat disconnect mechanism.

The agent persists desired rules and reports per-service `applied` or `pending` synchronization. It retries every 10 seconds and before marking a restarted service healthy. Servers persist their last applied rules for startup, so an agent outage does not erase policy. Server peers/register/relay routes enforce these rules independently of Console's database device status. The existing hbbr `blacklist` remains a bandwidth limiter; it is not the new persistent ban policy.

## CI validation

Local compilation, application execution and tests are intentionally not part of this workflow. Repository CI builds/types/checks/tests the changes. Console CI includes backend and Node agent tests; web CI builds and runs focused server API/access tests; server CI checks all targets, tests management handlers and builds the managed image. The optional Console integration workflow checks out explicit server/web refs and exercises the five-service deployment in CI. For changes spanning repositories, pass refs containing the corresponding changes rather than using unrelated default branches.
