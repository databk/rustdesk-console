import {
  extractServerEvents,
  ServerEventsService,
  type ServerEvent,
} from './server-events.service';
import type { ServerManagementRuntimeConfig } from './server-management-settings.service';
import { ServerManagementSettingsService } from './server-management-settings.service';

const waitFor = async (check: () => boolean, timeoutMs = 2000) => {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const base: Partial<ServerManagementRuntimeConfig> = {
  url: 'http://hbbs:21120',
  token: 'a'.repeat(40),
};

const settingsStub = (config: Partial<ServerManagementRuntimeConfig> = {}) =>
  ({
    getActiveConfig: () => ({
      url: config.url,
      token: config.token ?? '',
      nodeId: config.nodeId ?? 'rustdesk',
      nodeName: config.nodeName ?? 'RustDesk',
    }),
  }) as unknown as ServerManagementSettingsService;

const events = (config: Partial<ServerManagementRuntimeConfig> = {}) =>
  new ServerEventsService(settingsStub(config));

describe('server event stream', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('parses complete frames, ignores keep-alives and tolerates malformed data', () => {
    const input =
      ': keep-alive\n\n' +
      'event: relay_registered\ndata: {"kind":"relay_registered","timestamp":"t","data":{"id":"relay-a","address":"relay-a:21117","generation":1}}\n\n' +
      'event: broken\ndata: not-json\n\n' +
      'data: {"kind":"peer_online","data":{"id":"123456789"}}\n\n';
    const { events, remainder } = extractServerEvents(input, '');
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      kind: 'relay_registered',
      data: { id: 'relay-a', address: 'relay-a:21117', generation: 1 },
    });
    expect(events[1]).toEqual({
      kind: 'peer_online',
      data: { id: '123456789' },
    });
    expect(remainder).toBe('');
  });

  it('keeps partial frames for the next chunk', () => {
    const first = extractServerEvents(
      'event: session_closed\ndata: {"kind":"session_closed","data":{"uuid":"u1"}}',
      '',
    );
    expect(first.events).toHaveLength(0);
    const second = extractServerEvents('\n\n', first.remainder);
    expect(second.events).toEqual([
      { kind: 'session_closed', data: { uuid: 'u1' } },
    ]);
  });

  it('maintains the live relay and session view', () => {
    const service = events(base);
    expect(service.isFresh()).toBe(false);
    const apply = (event: ServerEvent) => service.applyEvent(event);
    apply({
      kind: 'session_opened',
      data: {
        uuid: 'u1',
        relay_id: 'relay-a',
        session: { uuid: 'u1', bytes: 10 },
      },
    });
    apply({
      kind: 'session_opened',
      data: { uuid: 'u2', relay_id: 'relay-b', session: { uuid: 'u2' } },
    });
    expect(service.getSessions()).toHaveLength(2);
    expect(service.getSessionRelay('u1')).toBe('relay-a');
    expect(service.hasRelay('relay-a')).toBe(false);
    apply({ kind: 'relay_registered', data: { id: 'relay-a' } });
    expect(service.hasRelay('relay-a')).toBe(true);
    apply({ kind: 'session_closed', data: { uuid: 'u2' } });
    expect(service.getSessions()).toHaveLength(1);
    apply({ kind: 'relay_disconnected', data: { id: 'relay-a' } });
    expect(service.hasRelay('relay-a')).toBe(false);
    expect(service.getSessions()).toHaveLength(0);
    expect(service.getSessionRelay('u1')).toBeUndefined();
    expect(service.isFresh()).toBe(true);
  });

  it('ignores malformed event payloads', () => {
    const service = events(base);
    service.applyEvent({ kind: 'session_opened', data: {} });
    service.applyEvent({ kind: 'session_opened', data: { uuid: 'u1' } });
    service.applyEvent({ kind: 'session_closed', data: {} });
    service.applyEvent({ kind: 'relay_registered', data: {} });
    service.applyEvent({ kind: 'unknown', data: { id: 'x' } });
    expect(service.getSessions()).toHaveLength(0);
    expect(service.isFresh()).toBe(true);
  });

  it('stays inert when the upstream is not configured', async () => {
    const service = events({});
    expect(() => service.onModuleInit()).not.toThrow();
    expect(service.isFresh()).toBe(false);
    expect(service.getSessions()).toHaveLength(0);
    await service.onModuleDestroy();
  });

  it('stays inert when the token is too short', async () => {
    const service = events({ url: base.url, token: 'short' });
    expect(() => service.onModuleInit()).not.toThrow();
    expect(service.isFresh()).toBe(false);
    await service.onModuleDestroy();
  });

  it('keeps the live view fresh on keep-alive frames', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
      },
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation((input: unknown) => {
      const url = String(input);
      if (url === 'http://hbbs:21120/v1/events')
        return Promise.resolve(new Response(stream, { status: 200 }));
      if (url === 'http://hbbs:21120/v1/relays')
        return Promise.resolve(Response.json({ data: [] }));
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    const service = events(base);
    service.onModuleInit();
    // A fresh baseline alone makes the live view usable on quiet deployments.
    await waitFor(() => service.isFresh());
    expect(service.getSessions()).toHaveLength(0);
    now += 50_000;
    expect(service.isFresh()).toBe(false);
    // Keep-alive comment frames deliver no events but prove the stream is
    // still live, so they restore freshness.
    controller.enqueue(new TextEncoder().encode(': keep-alive\n\n'));
    await waitFor(() => service.isFresh());
    expect(service.getSessions()).toHaveLength(0);
    await service.onModuleDestroy();
  });

  it('releases the stream connection and freshness when the baseline fails', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start: () => {},
      cancel: () => {
        cancelled = true;
      },
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation((input: unknown) => {
      const url = String(input);
      if (url === 'http://hbbs:21120/v1/events')
        return Promise.resolve(new Response(stream, { status: 200 }));
      return Promise.resolve(new Response('error', { status: 500 }));
    });
    const service = events(base);
    service.onModuleInit();
    // The rejected baseline must still close the open event connection.
    await waitFor(() => cancelled);
    expect(service.isFresh()).toBe(false);
    await service.onModuleDestroy();
  });

  it('abandons the stream when a restart was requested while connecting', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start: () => {},
      cancel: () => {
        cancelled = true;
      },
    });
    let releaseFetch!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    let eventsCalls = 0;
    jest.spyOn(globalThis, 'fetch').mockImplementation((input: unknown) => {
      const url = String(input);
      if (url === 'http://hbbs:21120/v1/events') {
        eventsCalls += 1;
        if (eventsCalls === 1)
          // The first connection is still being established when the
          // restart arrives, so there is no reader to cancel yet.
          return gate.then(() => new Response(stream, { status: 200 }));
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start: (controller) => controller.close(),
            }),
            { status: 200 },
          ),
        );
      }
      if (url === 'http://hbbs:21120/v1/relays')
        return Promise.resolve(Response.json({ data: [] }));
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    const service = events(base);
    service.onModuleInit();
    service.restart();
    releaseFetch();
    // The gated stream is abandoned instead of being followed until it ends.
    await waitFor(() => cancelled);
    await service.onModuleDestroy();
  });

  it('shuts down promptly while waiting to reconnect', async () => {
    const mock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: unknown) =>
        Promise.reject(new Error(`network down: ${String(input)}`)),
      );
    const service = events(base);
    service.onModuleInit();
    await waitFor(() => mock.mock.calls.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const started = Date.now();
    await service.onModuleDestroy();
    expect(Date.now() - started).toBeLessThan(500);
  });
});
