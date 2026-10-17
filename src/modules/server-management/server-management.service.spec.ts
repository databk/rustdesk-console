import { ConfigService } from '@nestjs/config';
import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  NotImplementedException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { REQUIRE_PERMISSION_KEY } from '../rbac/decorators/require-permission.decorator';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';
import { ServerEventsService } from './server-events.service';
import { ServerManagementController } from './server-management.controller';
import { RustdeskService, ServiceAction } from './server-management.dto';
import { ServerManagementService } from './server-management.service';

jest.mock('uuid', () => ({
  v4: jest.requireActual<typeof import('node:crypto')>('node:crypto')
    .randomUUID,
}));

const base = {
  HBBS_MANAGEMENT_URL: 'http://hbbs:21120',
  SERVER_MANAGEMENT_TOKEN: 'a'.repeat(40),
  SERVER_MANAGEMENT_NODE_ID: 'main',
};

const inertEvents = () => new ServerEventsService(new ConfigService({}));

describe('server management v2 client', () => {
  const audit = { record: jest.fn(), recordDenied: jest.fn() };
  const create = (
    config: Record<string, string> = base,
    events?: ServerEventsService,
  ) =>
    new ServerManagementService(
      new ConfigService(config),
      audit as unknown as RbacAuditService,
      events ?? inertEvents(),
    );

  const fetchRoute = (routes: Array<[string | RegExp, unknown]>) => {
    const mock = jest.spyOn(globalThis, 'fetch');
    mock.mockImplementation((input: unknown) => {
      const url = String(input);
      for (const [pattern, body] of routes)
        if (typeof pattern === 'string' ? url === pattern : pattern.test(url))
          return Promise.resolve(Response.json(body));
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    return mock;
  };

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('allows deployments without server management', async () => {
    const service = create({});
    expect(await service.list()).toEqual({ data: [] });
    await expect(service.peers('main')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects invalid upstream configuration', () => {
    expect(() =>
      create({ ...base, HBBS_MANAGEMENT_URL: 'http://hbbs:21120/api' }),
    ).toThrow();
    expect(() =>
      create({ ...base, HBBS_MANAGEMENT_URL: 'ftp://hbbs' }),
    ).toThrow();
    expect(() =>
      create({ ...base, HBBS_MANAGEMENT_URL: 'http://user:pass@hbbs' }),
    ).toThrow();
    expect(() =>
      create({ ...base, SERVER_MANAGEMENT_TOKEN: 'short' }),
    ).toThrow();
    expect(() =>
      create({ ...base, SERVER_MANAGEMENT_NODE_ID: 'bad id' }),
    ).toThrow();
  });

  it('lists the hbbs node and each registered relay', async () => {
    const fetcher = fetchRoute([
      [
        'http://hbbs:21120/v1/status',
        {
          api_version: 1,
          service: 'hbbs',
          version: '1.1.17',
          uptime_seconds: 4,
        },
      ],
      [
        'http://hbbs:21120/v1/relays',
        {
          data: [
            {
              id: 'relay-a',
              address: 'relay-a:21117',
              version: '1.1.17',
              uptime_seconds: 2,
              sessions_count: 1,
            },
            { id: 'main' },
          ],
        },
      ],
    ]);
    const result = await create().list();
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      id: 'main',
      name: 'RustDesk',
      reachable: true,
      api_version: 1,
      node_id: 'main',
    });
    const services = result.data[0].services as Array<Record<string, unknown>>;
    expect(services[0]).toMatchObject({
      service: 'hbbs',
      state: 'running',
      running: true,
      available: true,
      runtime: { service: 'hbbs', version: '1.1.17' },
    });
    expect(typeof services[0].started_at).toBe('string');
    expect(result.data[1]).toMatchObject({
      id: 'relay-a',
      name: 'relay-a',
      relay: true,
      reachable: true,
      services: [{ service: 'hbbr', running: true, available: true }],
    });
    expect(fetcher).toHaveBeenCalledWith(
      'http://hbbs:21120/v1/status',
      expect.objectContaining({
        redirect: 'error',
        headers: expect.objectContaining({
          authorization: `Bearer ${base.SERVER_MANAGEMENT_TOKEN}`,
        }),
      }),
    );
  });

  it('reports an unreachable upstream without inventing service state', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline'));
    expect(await create().list()).toEqual({
      data: [{ id: 'main', name: 'RustDesk', reachable: false, services: [] }],
    });
  });

  it('never exposes the upstream credential or origin in responses', async () => {
    fetchRoute([
      [
        'http://hbbs:21120/v1/status',
        { api_version: 1, service: 'hbbs', uptime_seconds: 1 },
      ],
      ['http://hbbs:21120/v1/relays', { data: [] }],
    ]);
    const result = await create().list();
    expect(JSON.stringify(result)).not.toContain(base.SERVER_MANAGEMENT_TOKEN);
    expect(JSON.stringify(result)).not.toContain('hbbs:21120');
  });

  it('routes peers and merged sessions per node', async () => {
    fetchRoute([
      ['http://hbbs:21120/v1/peers', { data: [{ id: '111111111' }] }],
      ['http://hbbs:21120/v1/relays', { data: [{ id: 'relay-a' }] }],
      [
        'http://hbbs:21120/v1/relays/relay-a/sessions',
        { data: [{ uuid: 'u1' }] },
      ],
    ]);
    const service = create();
    expect(await service.peers('main')).toEqual({
      data: [{ id: '111111111' }],
    });
    expect(await service.peers('relay-a')).toEqual({ data: [] });
    expect(await service.sessions('relay-a')).toEqual({
      data: [{ uuid: 'u1' }],
    });
    expect(await service.sessions('main')).toEqual({
      data: [{ uuid: 'u1', relay_id: 'relay-a' }],
    });
    await expect(service.peers('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('tolerates one failing relay when listing primary sessions', async () => {
    fetchRoute([
      [
        'http://hbbs:21120/v1/relays',
        { data: [{ id: 'relay-a' }, { id: 'relay-b' }] },
      ],
      // relay-b has no route and fails; the aggregated list still returns.
      [
        'http://hbbs:21120/v1/relays/relay-a/sessions',
        { data: [{ uuid: 'u1' }] },
      ],
    ]);
    const result = await create().sessions('main');
    expect(result).toEqual({ data: [{ uuid: 'u1', relay_id: 'relay-a' }] });
  });

  it('disconnects a session through the owning relay and audits it', async () => {
    fetchRoute([
      ['http://hbbs:21120/v1/relays', { data: [{ id: 'relay-a' }] }],
      [
        'http://hbbs:21120/v1/relays/relay-a/sessions',
        { data: [{ uuid: 'u1' }] },
      ],
      [/\/v1\/relays\/relay-a\/sessions\/u1$/, { state: 'closing' }],
    ]);
    const result = await create().disconnect('actor', 'main', 'u1');
    expect(result).toEqual({ state: 'closing' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetGuid: 'main',
        action: 'DELETE /v1/sessions/u1',
        result: 'allowed',
      }),
    );
    await expect(
      create().disconnect('actor', 'main', 'unknown'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.recordDenied).toHaveBeenCalled();
  });

  it('prefers the live event stream when it is fresh', async () => {
    const mock = jest.spyOn(globalThis, 'fetch');
    const events = {
      isFresh: () => true,
      hasRelay: (id: string) => id === 'relay-b',
      getSessions: () => [{ relayId: 'relay-b', info: { uuid: 'u2' } }],
      getSessionRelay: (uuid: string) =>
        uuid === 'u2' ? 'relay-b' : undefined,
    } as unknown as ServerEventsService;
    const service = create(base, events);
    mock.mockResolvedValue(Response.json({ state: 'closing' }));
    expect(await service.peers('relay-b')).toEqual({ data: [] });
    expect(await service.sessions('main')).toEqual({
      data: [{ uuid: 'u2', relay_id: 'relay-b' }],
    });
    expect(await service.sessions('relay-b')).toEqual({
      data: [{ uuid: 'u2' }],
    });
    expect(await service.disconnect('actor', 'main', 'u2')).toEqual({
      state: 'closing',
    });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith(
      'http://hbbs:21120/v1/relays/relay-b/sessions/u2',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('maps configuration views and keeps the frontend contract', async () => {
    fetchRoute([
      ['http://hbbs:21120/v1/relays', { data: [{ id: 'relay-a' }] }],
      [
        'http://hbbs:21120/v1/relays/relay-a/config',
        {
          schema: [{ name: 'port' }],
          values: { port: '21117' },
          pending_restart: { 'limit-speed': { current: '0', pending: '64' } },
        },
      ],
      [
        'http://hbbs:21120/v1/config',
        {
          schema: [],
          values: { 'always-use-relay': 'N' },
          pending_restart: {},
        },
      ],
    ]);
    const service = create();
    expect(await service.config('relay-a', RustdeskService.HBBR)).toEqual({
      schema: [{ name: 'port' }],
      values: { port: '21117' },
      effective_values: { port: '21117' },
      pending_restart: true,
      pending_restart_detail: {
        'limit-speed': { current: '0', pending: '64' },
      },
      available: true,
    });
    expect(await service.config('main', RustdeskService.HBBS)).toMatchObject({
      pending_restart: false,
      available: true,
    });
    await expect(
      service.config('main', RustdeskService.HBBR),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.config('relay-a', RustdeskService.HBBS),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('saves configuration without leaking values into the audit', async () => {
    fetchRoute([
      [
        'http://hbbs:21120/v1/config',
        { schema: [], values: { key: '__REDACTED__' }, pending_restart: {} },
      ],
    ]);
    const mock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: unknown, _init?: RequestInit) => {
        expect(String(input)).toBe('http://hbbs:21120/v1/config');
        return Promise.resolve(
          Response.json({
            schema: [],
            values: { key: '__REDACTED__' },
            pending_restart: {},
          }),
        );
      });
    await create().saveConfig('actor', 'main', RustdeskService.HBBS, {
      values: { key: 'private-key-material' },
    });
    expect(mock).toHaveBeenCalledWith(
      'http://hbbs:21120/v1/config',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ values: { key: 'private-key-material' } }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ afterState: { settings: ['key'] } }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
      'private-key-material',
    );
  });

  it('maps in-memory logs to text and validates the tail', async () => {
    fetchRoute([
      [/\/v1\/logs\?tail=50$/, { data: ['line-1', 'line-2'] }],
      ['http://hbbs:21120/v1/relays', { data: [{ id: 'relay-a' }] }],
      [/\/v1\/relays\/relay-a\/logs\?tail=50$/, { data: ['relay-line'] }],
    ]);
    const service = create();
    expect(await service.logs('main', RustdeskService.HBBS, 50)).toEqual({
      text: 'line-1\nline-2',
    });
    expect(await service.logs('relay-a', RustdeskService.HBBR, 50)).toEqual({
      text: 'relay-line',
    });
    for (const tail of [0, 2001, 1.5])
      await expect(
        service.logs('main', RustdeskService.HBBS, tail),
      ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps service actions to the v2 restart semantics', async () => {
    fetchRoute([
      [
        'http://hbbs:21120/v1/config',
        {
          values: {},
          pending_restart: { port: { current: '1', pending: '2' } },
        },
      ],
      ['http://hbbs:21120/v1/restart', { state: 'restarting' }],
      ['http://hbbs:21120/v1/relays', { data: [{ id: 'relay-a' }] }],
      ['http://hbbs:21120/v1/relays/relay-a/restart', { state: 'restarting' }],
    ]);
    const service = create();
    expect(
      await service.serviceAction(
        'actor',
        'main',
        RustdeskService.HBBS,
        ServiceAction.RESTART,
      ),
    ).toEqual({ state: 'restarting' });
    expect(
      await service.serviceAction(
        'actor',
        'relay-a',
        RustdeskService.HBBR,
        ServiceAction.RESTART,
      ),
    ).toEqual({ state: 'restarting' });
    expect(
      await service.serviceAction(
        'actor',
        'main',
        RustdeskService.HBBS,
        ServiceAction.APPLY,
      ),
    ).toEqual({ state: 'restarting' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'POST /v1/services/hbbs/apply',
        result: 'allowed',
      }),
    );
    await expect(
      service.serviceAction(
        'actor',
        'main',
        RustdeskService.HBBS,
        ServiceAction.START,
      ),
    ).rejects.toBeInstanceOf(NotImplementedException);
    await expect(
      service.serviceAction(
        'actor',
        'main',
        RustdeskService.HBBS,
        ServiceAction.STOP,
      ),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('reports apply as applied when nothing requires a restart', async () => {
    fetchRoute([
      ['http://hbbs:21120/v1/config', { values: {}, pending_restart: {} }],
    ]);
    expect(
      await create().serviceAction(
        'actor',
        'main',
        RustdeskService.HBBS,
        ServiceAction.APPLY,
      ),
    ).toEqual({ state: 'applied' });
  });

  it('maps ban policies for both services', async () => {
    fetchRoute([
      [
        'http://hbbs:21120/v1/bans',
        { device_ids: ['123456'], ips: ['192.0.2.1'] },
      ],
    ]);
    const service = create();
    expect(await service.bans('main')).toEqual({
      device_ids: ['123456'],
      ips: ['192.0.2.1'],
      synchronization: {
        hbbs: { state: 'applied' },
        hbbr: { state: 'applied' },
      },
    });
    await expect(service.bans('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('saves ban policies and audits the rule sets', async () => {
    fetchRoute([['http://hbbs:21120/v1/bans', { device_ids: [], ips: [] }]]);
    const mock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: unknown) => {
        expect(String(input)).toBe('http://hbbs:21120/v1/bans');
        return Promise.resolve(Response.json({ device_ids: [], ips: [] }));
      });
    await create().saveBans('actor', 'main', {
      device_ids: ['123456'],
      ips: [],
    });
    expect(mock).toHaveBeenCalledWith(
      'http://hbbs:21120/v1/bans',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ device_ids: ['123456'], ips: [] }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PUT /v1/bans',
        afterState: { device_ids: ['123456'], ips: [] },
      }),
    );
  });

  it('maps upstream HTTP errors to console errors', async () => {
    const mock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: unknown) => {
        const url = String(input);
        if (url.endsWith('/v1/relays'))
          return Promise.resolve(Response.json({ data: [] }));
        if (url.endsWith('/v1/peers'))
          return Promise.resolve(
            new Response('{"error":"x"}', { status: 400 }),
          );
        if (url.endsWith('/v1/logs?tail=5'))
          return Promise.resolve(
            new Response('{"error":"x"}', { status: 502 }),
          );
        if (url.endsWith('/v1/config'))
          return Promise.resolve(
            new Response('{"error":"x"}', { status: 504 }),
          );
        if (url.endsWith('/v1/bans'))
          return Promise.resolve(
            new Response('{"error":"x"}', { status: 404 }),
          );
        return Promise.resolve(new Response('[]'));
      });
    const service = create();
    await expect(service.peers('main')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.logs('main', RustdeskService.HBBS, 5),
    ).rejects.toBeInstanceOf(BadGatewayException);
    await expect(
      service.config('main', RustdeskService.HBBS),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
    await expect(service.bans('main')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    mock.mockResolvedValue(new Response('[]'));
    await expect(
      service.config('main', RustdeskService.HBBS),
    ).rejects.toBeInstanceOf(BadGatewayException);
    mock.mockRejectedValue(new Error('Offline'));
    await expect(service.peers('main')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('does not report an applied operation as failed when audit persistence fails', async () => {
    fetchRoute([['http://hbbs:21120/v1/restart', { state: 'restarting' }]]);
    audit.record.mockRejectedValueOnce(new Error('Audit storage unavailable'));
    await expect(
      create().serviceAction(
        'actor',
        'main',
        RustdeskService.HBBS,
        ServiceAction.RESTART,
      ),
    ).resolves.toEqual({ state: 'restarting' });
  });

  it('requires global server permissions, not device permissions', () => {
    const prototype = ServerManagementController.prototype;
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.action),
    ).toEqual(['servers.control']);
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.saveConfig),
    ).toEqual(['servers.config']);
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.disconnect),
    ).toEqual(['servers.disconnect']);
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.saveBans),
    ).toEqual(['servers.ban']);
  });
});
