# RustDesk server management

Console manages hbbs and hbbr instances by calling their private management APIs directly. No intermediary agent process is required. The server registry is stored in the Console database and managed through a CRUD API; adding or removing servers does not require a backend restart. Client protocol messages remain compatible. No browser receives server management credentials.

## Architecture

```
Browser → Console (NestJS) → hbbs management API (direct, 1 instance)
                           → hbbr[i] management API (direct, fan-out to n instances)
```

Console stores the server registry (URLs and management tokens) in the `server_nodes` table. Each entry has a role of `hbbs` or `hbbr`. The topology constraint is 1 APIServer + 1 hbbs + n hbbr; the create endpoint rejects a second hbbs node. Ban policy is stored in the `server_ban_policies` table and distributed to all registered servers on every update.

## Integrated deployment

Place `rustdesk-console`, `rustdesk-console-web`, and `rustdesk-server` beside each other. Initialize the server's submodules. Copy `.env.integrated.example` to a deployment environment file and replace each secret with a different random value (tokens require at least 32 characters). Set the public relay address. The deployment command is:

```sh
docker compose --env-file .env.integrated -f docker-compose.integrated.yml up -d --build
```

After the stack starts, sign in to Console and register the hbbs and hbbr nodes through the API:

```
POST /api/servers
{ "role": "hbbs", "name": "Primary hbbs", "url": "http://hbbs:21120", "managementToken": "<SERVER_MANAGEMENT_TOKEN>" }

POST /api/servers
{ "role": "hbbr", "name": "Primary hbbr", "url": "http://hbbr:21121", "managementToken": "<SERVER_MANAGEMENT_TOKEN>" }
```

Repository CI builds these images before deployment. Console HTTP is bound to `127.0.0.1:21114` for local access and a host-local TLS reverse proxy. Before enabling remote access, sign in locally and replace the default `databk/databk` administrator password. Keep the loopback binding; publish only the proxy HTTPS endpoint with a valid certificate. Proxy all paths, including `/api/`, to `http://127.0.0.1:21114` and preserve the 300-second management request timeout. Do not publish the HTTP login directly. TLS protects login credentials and bearer tokens in transit; password rotation is required separately. Protocol ports are 21115–21119. Server management ports (21120, 21121) have no host publication; Console reaches them over the internal Docker network.

## Permissions and endpoints

All operations require the existing JWT authentication. Super administrators have access; delegated roles may receive these **global**, backend-owned permissions:

| Permission | Capability |
| --- | --- |
| `servers.view` | Server nodes, status, hbbs registrations, hbbr sessions, config |
| `servers.manage` | Register, update, and remove server nodes |
| `servers.config` | Read and save server configuration |
| `servers.disconnect` | Close an hbbr session |
| `servers.ban` | Read, save, and distribute ban rules |

Every additional permission requires `servers.view`. Mutations are recorded in Console audit with actor, node, and operation; configuration values and credentials are excluded.

| Console endpoint | Methods |
| --- | --- |
| `/api/servers` | GET, POST |
| `/api/servers/:id` | PATCH, DELETE |
| `/api/servers/:id/peers` | GET |
| `/api/servers/:id/sessions` | GET |
| `/api/servers/:id/sessions/:uuid` | DELETE |
| `/api/servers/:id/config` | GET, PUT |
| `/api/servers/bans` | GET, PUT |

Server management APIs carry `api_version: 1`. hbbs exposes status/config/peers/bans. hbbr exposes status/config/sessions/bans and session deletion. APIs require independent Bearer credentials. Server APIs are opt-in through `RD_MANAGEMENT_BIND`, `RD_MANAGEMENT_TOKEN`, and `RD_MANAGEMENT_DIR`; existing deployments have no new listener by default.

## Server registry

Server nodes are stored in the `server_nodes` table with a UUID primary key, role (`hbbs` or `hbbr`), display name, management API URL, and management token. The URL and token columns are excluded from default SELECT queries (`select: false`) to prevent accidental credential exposure in API responses. The `status` column is updated by a periodic health check (every 30 seconds) that calls each server's `/v1/status` endpoint.

Creating a node requires the `servers.manage` permission. The create endpoint enforces:
- At most one `hbbs` node (the topology is 1 hbbs + n hbbr).
- At most 100 total nodes.
- URLs must be HTTP(S) origins without credentials, paths, query strings, or fragments.
- Management tokens must be at least 32 characters.

Updating a node (`PATCH /api/servers/:id`) accepts optional `name`, `url`, and `managementToken` fields. Deleting a node (`DELETE /api/servers/:id`) removes it from the registry; the server itself is not affected.

## Configuration lifecycle

`GET /api/servers/:id/config` calls the server's `/v1/config` endpoint directly and returns the effective configuration. `PUT /api/servers/:id/config` forwards the override to the server. Values are strings; omitted fields fall back to deployment arguments/environment. Saving persists a complete override document on the server; it does **not** change the running process until the server is restarted. Managed overrides take priority over CLI, config files, and environment at the next start. A key shown as `__REDACTED__` preserves the stored key override; without an override it preserves the deployment key.

Container lifecycle (start, stop, restart) is managed by the deployment orchestrator (Docker Compose, Kubernetes, systemd), not by the Console API. Port changes are deployment manifest changes, not runtime API calls.

## Ban policy

Ban policy is stored in the Console database as a single source of truth. `PUT /api/servers/bans` saves the policy and fans out `PUT /v1/bans` to all registered server nodes (hbbs and all hbbr instances). The response includes a `synchronization` array showing per-node `applied` or `pending` state. Unreachable nodes are marked `pending`; the health check loop retries synchronization on subsequent intervals.

Ban updates accept `{ "device_ids": ["123456"], "ips": ["192.0.2.1"] }`. Device-ID rules reject registration and requests targeting that ID. The ID in a relay request is client-reported; it is not an authenticated identity of both endpoints. IP rules compare both relay endpoints, normalize mapped IPv4 addresses, and also block hbbs requests. Already-established relay sessions matching a rule are cancelled. Existing direct connections are outside hbbr and continue to use Console's client heartbeat disconnect mechanism.

Servers persist their last applied rules for startup, so a Console outage does not erase policy. Server peers/register/relay routes enforce these rules independently of Console's database device status. The existing hbbr `blacklist` remains a bandwidth limiter; it is not the persistent ban policy.

## Health monitoring

A scheduled task (`@Interval(30000)`) polls each server's `/v1/status` endpoint every 30 seconds and updates the `status` (`online`, `offline`, `degraded`) and `lastCheckedAt` columns. A server is `online` when its management API responds with `api_version: 1` and the expected `service` name. It is `degraded` when the API responds but the response is incompatible. It is `offline` when the API is unreachable. The health check respects maintenance mode and skips writes when `businessWritesAllowed()` returns false.

## CI validation

The repository CI provides permanent build, type, lint, and regression checks. Console CI includes backend tests that verify the direct-connect service, ban fan-out, and permission requirements. Server CI checks all targets, tests management handlers, and builds the managed image. Per-repository CI does not establish full-stack interoperability. Coordinated release validation should exercise the deployed Console and native servers together.
