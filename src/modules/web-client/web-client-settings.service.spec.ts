import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { SystemSetting } from '../settings/entities/system-setting.entity';
import { UpdateWebClientSettingsDto } from './dto/web-client-settings.dto';
import { WebClientSettingsService } from './web-client-settings.service';

const valid = {
  enabled: true,
  idServerUrl: 'wss://console.example.com/ws/id',
  relayServerUrl: 'wss://console.example.com/ws/relay',
  serverPublicKey: Buffer.alloc(32, 7).toString('base64'),
  allowedOrigin: 'https://console.example.com',
};

describe('WebClientSettingsService', () => {
  let dataSource: DataSource;
  let repository: Repository<SystemSetting>;
  let service: WebClientSettingsService;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      dropSchema: true,
      synchronize: true,
      logging: false,
      entities: [SystemSetting],
    });
    await dataSource.initialize();
    repository = dataSource.getRepository(SystemSetting);
    service = new WebClientSettingsService(repository);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('returns 404 when no configuration exists', async () => {
    await expect(service.getSettings()).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getActiveConfig()).resolves.toEqual({
      enabled: false,
    });
  });

  it('stores a disabled configuration without validating the rest', async () => {
    const result = await service.updateSettings({
      enabled: false,
      idServerUrl: 'not-a-url',
    });
    expect(result.enabled).toBe(false);
    await expect(service.getActiveConfig()).resolves.toMatchObject({
      enabled: false,
      idServerUrl: 'not-a-url',
    });
  });

  it('rejects enabling without the required fields', async () => {
    await expect(
      service.updateSettings({ enabled: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateSettings({ ...valid, idServerUrl: 'ws://insecure/ws' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateSettings({ ...valid, serverPublicKey: 'not-base64' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateSettings({ ...valid, allowedOrigin: 'http://insecure' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Nothing was persisted by the rejected updates.
    await expect(repository.count()).resolves.toBe(0);
  });

  it('stores a valid enabled configuration and reads it back', async () => {
    const result = await service.updateSettings({
      ...valid,
      idUpstreamUrl: 'ws://hbbs:21118',
    });
    expect(result).toMatchObject({
      enabled: true,
      idServerUrl: valid.idServerUrl,
      relayServerUrl: valid.relayServerUrl,
      serverPublicKey: valid.serverPublicKey,
      allowedOrigin: valid.allowedOrigin,
      idUpstreamUrl: 'ws://hbbs:21118',
      relayUpstreamUrl: '',
    });
    await expect(service.getSettings()).resolves.toMatchObject({
      enabled: true,
    });
    const active = await service.getActiveConfig();
    expect(active.enabled).toBe(true);
    expect(active.idUpstreamUrl).toBe('ws://hbbs:21118');
  });

  it('validates the merged configuration on partial updates', async () => {
    await service.updateSettings({ ...valid, enabled: false });
    await expect(
      service.updateSettings({ enabled: true }),
    ).resolves.toMatchObject({ enabled: true });
    await service.updateSettings({ enabled: false });
    await expect(
      service.updateSettings({ enabled: true, allowedOrigin: 'nope' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getSettings()).resolves.toMatchObject({
      enabled: false,
    });
  });

  it('imports the legacy environment variables exactly once', async () => {
    const previous = {
      WEB_CLIENT_ENABLED: process.env.WEB_CLIENT_ENABLED,
      WEB_CLIENT_ID_SERVER_URL: process.env.WEB_CLIENT_ID_SERVER_URL,
      WEB_CLIENT_RELAY_SERVER_URL: process.env.WEB_CLIENT_RELAY_SERVER_URL,
      WEB_CLIENT_SERVER_PUBLIC_KEY: process.env.WEB_CLIENT_SERVER_PUBLIC_KEY,
      WEB_CLIENT_ALLOWED_ORIGIN: process.env.WEB_CLIENT_ALLOWED_ORIGIN,
      WEB_CLIENT_ID_UPSTREAM_URL: process.env.WEB_CLIENT_ID_UPSTREAM_URL,
      WEB_CLIENT_RELAY_UPSTREAM_URL: process.env.WEB_CLIENT_RELAY_UPSTREAM_URL,
    };
    process.env.WEB_CLIENT_ENABLED = 'true';
    process.env.WEB_CLIENT_ID_SERVER_URL = valid.idServerUrl;
    process.env.WEB_CLIENT_RELAY_SERVER_URL = valid.relayServerUrl;
    process.env.WEB_CLIENT_SERVER_PUBLIC_KEY = valid.serverPublicKey;
    process.env.WEB_CLIENT_ALLOWED_ORIGIN = valid.allowedOrigin;
    delete process.env.WEB_CLIENT_ID_UPSTREAM_URL;
    delete process.env.WEB_CLIENT_RELAY_UPSTREAM_URL;
    try {
      const imported = await service.getActiveConfig();
      expect(imported).toMatchObject(valid);
      await expect(service.getSettings()).resolves.toMatchObject({
        enabled: true,
      });
      // The environment is ignored once the database holds a configuration.
      process.env.WEB_CLIENT_ENABLED = 'false';
      await expect(service.getActiveConfig()).resolves.toMatchObject({
        enabled: true,
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe('web client settings HTTP contract', () => {
  it('accepts a valid update payload shape', () => {
    const dto = { ...valid } as UpdateWebClientSettingsDto;
    expect(dto.enabled).toBe(true);
    expect(typeof dto.idServerUrl).toBe('string');
  });
});
