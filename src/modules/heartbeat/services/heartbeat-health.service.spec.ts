import { HeartbeatHealthService } from './heartbeat-health.service';

interface ServiceOptions {
  total?: number;
  online?: number;
  latestHeartbeat?: Date | null;
  frontendUrl?: string;
}

function createService(options: ServiceOptions = {}) {
  const peerRepository = {
    count: jest.fn().mockResolvedValue(options.total ?? 0),
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(options.online ?? 0),
    }),
    findOne: jest
      .fn()
      .mockResolvedValue(
        options.latestHeartbeat
          ? { uuid: 'device-uuid', lastHeartbeat: options.latestHeartbeat }
          : null,
      ),
  };
  const generalSettings = {
    getSiteSettings: jest.fn().mockResolvedValue({
      frontendUrl: options.frontendUrl ?? '',
      backendUrl: '',
      effectiveFrontendUrl: options.frontendUrl ?? '',
      effectiveBackendUrl: options.frontendUrl ?? '',
    }),
  };
  return {
    service: new HeartbeatHealthService(
      peerRepository as never,
      generalSettings as never,
    ),
    peerRepository,
    generalSettings,
  };
}

describe('HeartbeatHealthService', () => {
  it('reports ok on an empty deployment', async () => {
    const { service } = createService({
      total: 0,
      online: 0,
      frontendUrl: 'https://console.example.com',
    });
    await service.onModuleInit();

    const health = await service.getHealth();

    expect(health.status).toBe('ok');
    expect(health.likelyApiServerSchemeMismatch).toBe(false);
    expect(health.devices).toEqual({ total: 0, online: 0, stale: 0 });
  });

  it('reports ok while heartbeats keep arriving', async () => {
    const { service } = createService({
      total: 3,
      online: 3,
      latestHeartbeat: new Date(Date.now() - 10_000),
      frontendUrl: 'https://console.example.com',
    });
    await service.onModuleInit();

    const health = await service.getHealth();

    expect(health.status).toBe('ok');
    expect(health.heartbeat.degraded).toBe(false);
    expect(health.devices).toEqual({ total: 3, online: 3, stale: 0 });
  });

  it('flags an HTTPS deployment where every device is heartbeat-stale', async () => {
    const { service } = createService({
      total: 5,
      online: 0,
      latestHeartbeat: new Date(Date.now() - 5 * 60 * 1000),
      frontendUrl: 'https://console.example.com',
    });
    await service.onModuleInit();

    const health = await service.getHealth();

    expect(health.status).toBe('suspected_api_scheme_mismatch');
    expect(health.likelyApiServerSchemeMismatch).toBe(true);
    expect(health.heartbeat.degraded).toBe(true);
    expect(health.devices.total).toBe(5);
    expect(health.devices.stale).toBe(5);
    expect(health.site.exposedOverHttps).toBe(true);
    expect(health.site.usesHttpsOn21114).toBe(false);
    expect(health.suggestedApiServer).toBe('https://console.example.com');
  });

  it('does not blame the API scheme on a plain-HTTP deployment', async () => {
    const { service } = createService({
      total: 5,
      online: 0,
      latestHeartbeat: new Date(Date.now() - 5 * 60 * 1000),
      frontendUrl: 'http://console.example.com',
    });
    await service.onModuleInit();

    const health = await service.getHealth();

    expect(health.status).toBe('heartbeat_stale');
    expect(health.likelyApiServerSchemeMismatch).toBe(false);
    expect(health.suggestedApiServer).toBe('http://console.example.com');
  });

  it('does not blame the API scheme when some devices are still online', async () => {
    const { service } = createService({
      total: 5,
      online: 1,
      latestHeartbeat: new Date(Date.now() - 5 * 60 * 1000),
      frontendUrl: 'https://console.example.com',
    });
    await service.onModuleInit();

    const health = await service.getHealth();

    expect(health.status).toBe('heartbeat_stale');
    expect(health.likelyApiServerSchemeMismatch).toBe(false);
  });

  it('reports HTTPS on 21114 so the UI can warn about the port rewrite', async () => {
    const { service } = createService({
      total: 1,
      online: 0,
      latestHeartbeat: new Date(Date.now() - 5 * 60 * 1000),
      frontendUrl: 'https://console.example.com:21114',
    });
    await service.onModuleInit();

    const health = await service.getHealth();

    expect(health.site.usesHttpsOn21114).toBe(true);
    expect(health.suggestedApiServer).toBe('https://console.example.com:21114');
  });

  it('falls back to the request origin when site.frontendUrl is empty', async () => {
    const { service } = createService({
      total: 1,
      online: 0,
      latestHeartbeat: new Date(Date.now() - 5 * 60 * 1000),
    });
    await service.onModuleInit();

    const health = await service.getHealth('https://console.example.com');

    expect(health.site.effectiveOrigin).toBe('https://console.example.com');
    expect(health.likelyApiServerSchemeMismatch).toBe(true);
  });

  it('uses the persisted heartbeat when this replica has not seen one', async () => {
    const { service } = createService({
      total: 1,
      online: 1,
      latestHeartbeat: new Date(Date.now() - 10_000),
      frontendUrl: 'https://console.example.com',
    });

    // onModuleInit deliberately not called: the shared database must be enough.
    const health = await service.getHealth();

    expect(health.status).toBe('ok');
    expect(health.heartbeat.degraded).toBe(false);
    expect(health.devices).toEqual({ total: 1, online: 1, stale: 0 });
  });

  it('marks the heartbeat stream healthy as soon as one arrives', async () => {
    const { service } = createService({
      total: 2,
      online: 0,
      latestHeartbeat: new Date(Date.now() - 5 * 60 * 1000),
      frontendUrl: 'https://console.example.com',
    });
    await service.onModuleInit();

    expect((await service.getHealth()).heartbeat.degraded).toBe(true);

    service.markHeartbeat();

    const health = await service.getHealth();
    expect(health.heartbeat.degraded).toBe(false);
    expect(health.status).toBe('ok');
    expect(health.heartbeat.secondsSinceLastReceived).toBe(0);
    expect(health.devices).toEqual({ total: 2, online: 1, stale: 1 });
  });

  it('ignores an unparseable frontendUrl instead of inventing a scheme', async () => {
    const { service } = createService({
      total: 1,
      online: 0,
      latestHeartbeat: new Date(Date.now() - 5 * 60 * 1000),
      frontendUrl: 'not-a-url',
    });
    await service.onModuleInit();

    const health = await service.getHealth();

    expect(health.suggestedApiServer).toBeNull();
    expect(health.likelyApiServerSchemeMismatch).toBe(false);
  });
});
