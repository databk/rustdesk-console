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

  it('rejects URLs without an explicit authority', async () => {
    // Special-scheme forms parse as wss:// URLs but must not be accepted;
    // they previously crashed validation with a TypeError instead of a 400.
    await expect(
      service.updateSettings({
        ...valid,
        idServerUrl: 'wss:console.example.com',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateSettings({
        ...valid,
        relayServerUrl: 'wss:/console.example.com/ws/relay',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
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
});

describe('web client settings HTTP contract', () => {
  it('accepts a valid update payload shape', () => {
    const dto = { ...valid } as UpdateWebClientSettingsDto;
    expect(dto.enabled).toBe(true);
    expect(typeof dto.idServerUrl).toBe('string');
  });
});
