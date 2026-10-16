# RustDesk server management

The Console web application calls `/api/servers`; the NestJS backend authenticates the user and checks global server permissions. The backend talks to a single upstream: the hbbs management API (`/v1`). Relay nodes (hbbr) register with hbbs over an outbound WebSocket and are proxied through it, so Console needs one credential and one URL for the whole deployment. There is no per-node agent, no Docker socket mount, and no shared management volume. Client protocol messages remain compatible. No browser receives server management credentials.

## Integrated deployment

Place `rustdesk-console`, `rustdesk-console-web`, and `rustdesk-server` beside each other. Initialize the server's submodules. Copy `.env.integrated.example` to a deployment environment file and replace each secret with a different random value (tokens require at least 32 characters). Set the public relay address. The deployment command is:

```sh
docker compose --env-file .env.integrated -f docker-compose.integrated.yml up -d --build
```

Console HTTP is bound to `127.0.0.1:21114` for local access and a host-local TLS reverse proxy. Before enabling remote access, sign in locally and replace the default `databk/databk` administrator password. Keep the loopback binding; publish only the proxy HTTPS endpoint with a valid certificate. Proxy all paths, including `/api/`, to `http://127.0.0.1:21114`. Do not publish the HTTP login directly. TLS protects login credentials and bearer tokens in transit; password rotation is required separately. Protocol ports are 21115-21119. The management listener has no host publication.

The integrated template runs exactly four containers:

- **Console** is configured with `HBBS_MANAGEMENT_URL` (origin only), `SERVER_MANAGEMENT_TOKEN`, and `SERVER_MANAGEMENT_NODE_ID` (the display id of the primary node, `main` by default in the template). Management is disabled when `HBBS_MANAGEMENT_URL` is unset.
- **hbbs** enables its management API with `RD_MANAGEMENT_BIND`, `RD_MANAGEMENT_TOKEN`, and `RD_MANAGEMENT_DIR` (a persistent directory on its own volume).
- **hbbr** registers with hbbs through `RD_HBBS_API_URL`, authenticated by the same `RD_MANAGEMENT_TOKEN`. Its identity comes from `RD_RELAY_ID` and its published address from `RD_RELAY_ADDRESS`. Additional relay instances repeat this block with distinct ids; no further Console configuration is needed.

Server management is independent of the updater's Docker socket usage in `docker-compose.yml`; the management feature itself mounts nothing.

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

The node list combines the primary node (`SERVER_MANAGEMENT_NODE_ID`) with the relays registered at hbbs. `start`/`stop` are reported as unsupported outside container-based deployments; `restart` asks the target service to exit so its supervisor restarts it, and `apply` restarts only when the configuration reports `pending_restart`.

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

Repository CI provides build, type, lint and regression checks: Console CI runs backend and network tests; web CI builds and runs focused server API/access tests; server CI checks all targets, tests management handlers and builds the managed image. Coordinated release validation should still exercise the deployed Console and native servers together.
