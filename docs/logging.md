# Logging

The backend writes all logs to stdout through Nest's logger. In Docker, read them with `docker logs`.

## Settings

| Variable | Values | Default | Effect |
|---|---|---|---|
| `LOG_LEVEL` | `verbose`, `debug`, `log` (alias `info`), `warn`, `error`, `fatal` | `log` | Minimum level printed. `debug` adds per-request and per-device detail such as every heartbeat. |
| `DB_LOG` | `off`, `errors`, `queries` | `errors` | Database logging. `errors` reports failed and slow queries; `queries` adds every SQL statement at `debug` level (also set `LOG_LEVEL=debug`). |
| `DB_SLOW_QUERY_MS` | milliseconds, `0` to disable | `1000` | Queries that take longer than this are reported as slow. |

The effective level is printed at startup:

```
LOG [Bootstrap] Log level: log (set LOG_LEVEL=debug for diagnostic output)
```

Query parameters, request bodies and query strings are never logged, because they can contain passwords, tokens and OIDC codes. Values quoted inside database error messages are replaced with `?`.

## What is logged where

- **HTTP requests** (`[HTTP]`): one line per request with method, path, status, duration and address. Successful requests, `401` and `404` are `debug`; other `4xx` and all `5xx` are `warn`. A request the client abandoned before a response was sent shows `aborted` instead of a status, at `debug`. Unhandled errors are also logged with a stack trace at `error`.
- **Database** (`[Database]`): failed queries and slow queries at `warn`. Unique-constraint conflicts are `debug`, because the application handles them (usually as a `409`, which appears in the `[HTTP]` line).
- **Modules**: each service logs under its own class name, for example `[HeartbeatService]` or `[LdapService]`.

## Troubleshooting examples

```sh
# Only warnings and errors
docker logs <container> 2>&1 | grep -E ' (WARN|ERROR) '

# Requests that failed
docker logs <container> 2>&1 | grep '\[HTTP\]' | grep -v ' 200 '

# Everything for one device
docker logs <container> 2>&1 | grep <device-uuid>
```

To diagnose devices or clients, temporarily set `LOG_LEVEL=debug`, restart the container, reproduce the problem, then set it back.

## Guidelines for contributors

Use Nest's logger in every class that needs to log:

```ts
private readonly logger = new Logger(MyService.name);
```

`console.*` is rejected by ESLint so that `LOG_LEVEL` applies everywhere. Choose the level by who needs to see the message:

| Level | Use for |
|---|---|
| `error` | An operation failed and needs attention. Pass the stack: `this.logger.error('Sync failed', errorTrace(error))` (from `src/common/logging/error-trace.ts`). |
| `warn` | Rejected, degraded or recovered situations worth noticing (failed login, upstream unreachable, retry). |
| `log` | State changes an administrator cares about: startup, configuration changes, create/update/delete, completed jobs. |
| `debug` | Per-request or per-device detail that repeats often (heartbeats, sysinfo). |
| `verbose` | Payload-level tracing for development. |

Include identifiers (GUIDs, device ids, job ids) so lines can be correlated. Never log passwords, tokens, secrets or request bodies. Wrap any value that came from an unauthenticated client, such as a submitted username, in `logSafe()` (from `src/common/logging/log-safe.ts`), which strips line breaks and truncates it. Logs complement the audit log; they do not replace it.
