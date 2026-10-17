import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { ServerManagementRuntimeConfig } from './server-management-settings.service';
import { ServerManagementSettingsService } from './server-management-settings.service';

// Aggregated event kinds published by the hbbs management API.
export type ServerEventKind =
  | 'peer_online'
  | 'peer_offline'
  | 'session_opened'
  | 'session_closed'
  | 'relay_registered'
  | 'relay_disconnected'
  | 'bans_replaced';

export interface ServerEvent {
  kind: string;
  data: Record<string, unknown>;
}

export interface LiveSession {
  relayId: string;
  info: Record<string, unknown>;
}

interface RelayPresence {
  id: string;
}

const SSE_IDLE_TIMEOUT_MS = 75_000;
const SSE_BUFFER_LIMIT = 1024 * 1024;
const FRESH_WINDOW_MS = 45_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const UNCONFIGURED_POLL_MS = 30_000;

// Extracts complete `event:`/`data:` frames from a raw SSE chunk. The caller
// keeps the returned remainder for the next chunk; comments and unknown
// fields are ignored per the server-sent events specification.
export function extractServerEvents(
  chunk: string,
  pending: string,
): { events: ServerEvent[]; remainder: string } {
  let buffer = pending + chunk;
  const events: ServerEvent[] = [];
  for (;;) {
    const boundary = buffer.search(/\r?\n\r?\n/);
    if (boundary < 0) break;
    const frame = buffer.slice(0, boundary);
    buffer = buffer.replace(/^[\s\S]*?(\r?\n\r?\n)/, '');
    let event: string | undefined;
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      const separator = line.indexOf(':');
      const field = separator < 0 ? line : line.slice(0, separator);
      const value =
        separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (!data.length) continue;
    try {
      const parsed: unknown = JSON.parse(data.join('\n'));
      const parsedKind =
        parsed && typeof parsed === 'object'
          ? (parsed as { kind?: unknown }).kind
          : undefined;
      const kind = event ?? (typeof parsedKind === 'string' ? parsedKind : '');
      if (
        !kind ||
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      )
        continue;
      const body = (parsed as { data?: unknown }).data;
      events.push({
        kind,
        data:
          body && typeof body === 'object' && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {},
      });
    } catch {
      // A malformed frame never breaks the stream.
    }
  }
  return { events, remainder: buffer };
}

// Consumes the aggregated hbbs event stream and maintains a live view of the
// registered relays and their sessions. The connection settings live in the
// database; the loop re-reads them on every (re)connect, so settings updates
// take effect without a restart. Falls back to nothing when disabled;
// readers always have an HTTP fallback when the stream is not fresh.
@Injectable()
export class ServerEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServerEventsService.name);
  private url?: string;
  private token = '';
  private restartRequested = false;
  private readonly relays = new Map<string, RelayPresence>();
  private readonly sessions = new Map<string, LiveSession>();
  private stopping = false;
  private lastEventAt = 0;
  private lastKeepAliveAt = 0;
  private runTask?: Promise<void>;
  private activeReader?: ReadableStreamDefaultReader<Uint8Array>;
  private baselineAbort?: AbortController;
  private wake?: () => void;

  constructor(private readonly settings: ServerManagementSettingsService) {}

  onModuleInit(): void {
    this.runTask = this.run();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.wake?.();
    this.baselineAbort?.abort();
    await this.activeReader?.cancel().catch(() => {});
    await this.runTask?.catch(() => {});
  }

  // Interrupts the current connection (if any) and reconnects immediately
  // with fresh settings; called after every settings update.
  restart(): void {
    this.restartRequested = true;
    this.wake?.();
    this.baselineAbort?.abort();
    void this.activeReader?.cancel().catch(() => {});
  }

  // The live view is only served while the stream is actually delivering:
  // a keep-alive arrives every 15 seconds, so 45 seconds covers two misses.
  isFresh(): boolean {
    const last = Math.max(this.lastEventAt, this.lastKeepAliveAt);
    return last > 0 && Date.now() - last < FRESH_WINDOW_MS;
  }

  getSessions(): LiveSession[] {
    return [...this.sessions.values()];
  }

  getSessionRelay(uuid: string): string | undefined {
    return this.sessions.get(uuid)?.relayId;
  }

  hasRelay(relayId: string): boolean {
    return this.relays.has(relayId);
  }

  // Applies one aggregated event to the live view. Public for tests.
  applyEvent(event: ServerEvent): void {
    const data = event.data || {};
    switch (event.kind) {
      case 'session_opened': {
        const uuid = data.uuid;
        const relayId = data.relay_id;
        const session = data.session;
        if (
          typeof uuid === 'string' &&
          uuid &&
          typeof relayId === 'string' &&
          relayId &&
          !!session &&
          typeof session === 'object' &&
          !Array.isArray(session)
        )
          this.sessions.set(uuid, {
            relayId,
            info: session as Record<string, unknown>,
          });
        break;
      }
      case 'session_closed': {
        if (typeof data.uuid === 'string') this.sessions.delete(data.uuid);
        break;
      }
      case 'relay_registered': {
        if (typeof data.id === 'string' && data.id && data.id !== this.token)
          this.relays.set(data.id, { id: data.id });
        break;
      }
      case 'relay_disconnected': {
        if (typeof data.id === 'string' && data.id) {
          this.relays.delete(data.id);
          for (const [uuid, session] of this.sessions)
            if (session.relayId === data.id) this.sessions.delete(uuid);
        }
        break;
      }
      default:
        break;
    }
    this.lastEventAt = Date.now();
  }

  private async loadConnection(): Promise<{
    url: string;
    token: string;
  } | null> {
    let config: ServerManagementRuntimeConfig;
    try {
      config = await this.settings.getActiveConfig();
    } catch (error) {
      this.logger.warn(
        `Unable to load server management settings: ${String(error)}`,
      );
      return null;
    }
    if (!config.url || config.token.length < 32) {
      this.url = undefined;
      return null;
    }
    return { url: config.url, token: config.token };
  }

  private async run(): Promise<void> {
    let backoff = RECONNECT_BASE_MS;
    while (!this.stopping) {
      // Entering a new iteration re-reads the settings and reconnects, so
      // restart requests from the previous iteration are already served.
      this.restartRequested = false;
      const connection = await this.loadConnection();
      if (!connection) {
        // Settings are absent or incomplete; poll until they appear.
        if (!this.stopping) await this.sleep(UNCONFIGURED_POLL_MS);
        continue;
      }
      this.url = connection.url;
      this.token = connection.token;
      try {
        await this.follow();
        backoff = RECONNECT_BASE_MS;
        this.logger.warn('hbbs event stream closed; reconnecting');
      } catch (error) {
        this.logger.warn(
          `hbbs event stream failed: ${String(error)}; reconnecting`,
        );
      }
      // The live view is no longer maintained once the stream ends; stop
      // serving it until a fresh baseline arrives on the next connection.
      this.lastEventAt = 0;
      this.lastKeepAliveAt = 0;
      if (this.stopping) return;
      if (this.restartRequested) {
        this.restartRequested = false;
        backoff = 0;
      }
      await this.sleep(backoff);
      backoff =
        backoff === 0
          ? RECONNECT_BASE_MS
          : Math.min(backoff * 2, RECONNECT_MAX_MS);
    }
  }

  // Interruptible backoff sleep so shutdown never waits out the timer.
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = undefined;
        resolve();
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
    });
  }

  private async follow(): Promise<void> {
    const response = await fetch(`${this.url}/v1/events`, {
      redirect: 'error',
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`event stream rejected (${response.status})`);
    }
    // The reader is taken up front so every exit path releases the
    // connection, including baseline failures and read errors.
    const reader = response.body.getReader();
    this.activeReader = reader;
    // Baseline requests are aborted on restart/shutdown so the loop never
    // keeps issuing requests with a stale URL and token.
    const baselineAbort = new AbortController();
    this.baselineAbort = baselineAbort;
    try {
      // A restart that arrived while the response was pending must not run
      // the baseline with the stale URL and token.
      if (this.restartRequested) return;
      // Reconnect on a fresh baseline: hbbs may have restarted and replayed
      // nothing while this connection was down.
      await this.refreshBaseline(baselineAbort.signal);
      this.lastKeepAliveAt = Date.now();
      const decoder = new TextDecoder();
      let pending = '';
      for (;;) {
        if (this.stopping || this.restartRequested) return;
        const { done, value } = await this.readWithDeadline(reader);
        if (done) return;
        // Any delivered bytes keep the stream fresh, including keep-alive
        // comment frames that produce no events.
        this.lastKeepAliveAt = Date.now();
        pending += decoder.decode(value, { stream: true });
        if (pending.length > SSE_BUFFER_LIMIT)
          throw new Error('frame overflow');
        const { events, remainder } = extractServerEvents(pending, '');
        pending = remainder;
        for (const event of events) this.applyEvent(event);
      }
    } finally {
      this.baselineAbort = undefined;
      this.activeReader = undefined;
      await reader.cancel().catch(() => {});
    }
  }

  private async readWithDeadline(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<ReadableStreamReadResult<Uint8Array>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('event stream idle')),
        SSE_IDLE_TIMEOUT_MS,
      );
      timer.unref?.();
    });
    try {
      return await Promise.race([reader.read(), deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async refreshBaseline(signal: AbortSignal): Promise<void> {
    const relays = (await this.fetchJson('/v1/relays', signal)) as {
      data?: Array<{ id?: unknown }>;
    };
    this.relays.clear();
    this.sessions.clear();
    for (const relay of Array.isArray(relays?.data) ? relays.data : []) {
      if (typeof relay?.id !== 'string' || !relay.id) continue;
      this.relays.set(relay.id, { id: relay.id });
      const sessions = (await this.fetchJson(
        `/v1/relays/${encodeURIComponent(relay.id)}/sessions`,
        signal,
      )) as { data?: unknown[] };
      for (const info of Array.isArray(sessions?.data) ? sessions.data : [])
        if (
          !!info &&
          typeof info === 'object' &&
          typeof (info as { uuid?: unknown }).uuid === 'string'
        )
          this.sessions.set((info as { uuid: string }).uuid, {
            relayId: relay.id,
            info: info as Record<string, unknown>,
          });
    }
  }

  private async fetchJson(path: string, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(`${this.url}${path}`, {
      redirect: 'error',
      headers: { authorization: `Bearer ${this.token}` },
      signal: combineAbortSignals([signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`baseline request rejected (${response.status})`);
    }
    return (await response.json()) as unknown;
  }
}

// Combines abort signals without AbortSignal.any, which needs a newer
// runtime than the engines field guarantees.
function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}
