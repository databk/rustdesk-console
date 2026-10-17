import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { SystemSetting } from '../settings/entities/system-setting.entity';
import { ServerManagementSettingsService } from './server-management-settings.service';

describe('ServerManagementSettingsService', () => {
  let dataSource: DataSource;
  let repository: Repository<SystemSetting>;
  let service: ServerManagementSettingsService;

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
    service = new ServerManagementSettingsService(repository);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('returns safe defaults when nothing is configured', async () => {
    await expect(service.getSettings()).resolves.toEqual({
      url: '',
      token: '',
      nodeId: 'rustdesk',
      nodeName: 'RustDesk',
      configured: false,
    });
    await expect(service.getActiveConfig()).resolves.toEqual({
      url: undefined,
      token: '',
      nodeId: 'rustdesk',
      nodeName: 'RustDesk',
    });
  });

  it('rejects invalid updates without persisting anything', async () => {
    await expect(
      service.updateSettings({
        url: 'http://hbbs:21120/api',
        token: 'a'.repeat(40),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateSettings({ url: 'ftp://hbbs', token: 'a'.repeat(40) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateSettings({
        url: 'http://user:pass@hbbs:21120',
        token: 'a'.repeat(40),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateSettings({ url: 'http://hbbs:21120', token: 'short' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateSettings({ nodeId: 'bad id' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateSettings({ nodeName: '  ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(repository.count()).resolves.toBe(0);
  });

  it('stores a valid configuration with the token masked in the view', async () => {
    const result = await service.updateSettings({
      url: 'http://hbbs:21120',
      token: 'a'.repeat(40),
      nodeId: 'main',
      nodeName: 'Primary node',
    });
    expect(result).toMatchObject({
      url: 'http://hbbs:21120',
      token: '******',
      nodeId: 'main',
      nodeName: 'Primary node',
      configured: true,
    });
    await expect(service.getActiveConfig()).resolves.toEqual({
      url: 'http://hbbs:21120',
      token: 'a'.repeat(40),
      nodeId: 'main',
      nodeName: 'Primary node',
    });
  });

  it('keeps the stored token when the mask placeholder is submitted', async () => {
    await service.updateSettings({
      url: 'http://hbbs:21120',
      token: 'a'.repeat(40),
    });
    const result = await service.updateSettings({
      token: '******',
      nodeName: 'Renamed',
    });
    expect(result.token).toBe('******');
    await expect(service.getActiveConfig()).resolves.toMatchObject({
      token: 'a'.repeat(40),
      nodeName: 'Renamed',
    });
  });

  it('disables management with an empty url and tolerates broken rows on read', async () => {
    await service.updateSettings({
      url: 'http://hbbs:21120',
      token: 'a'.repeat(40),
      nodeId: 'main',
    });
    await service.updateSettings({ url: '' });
    await expect(service.getActiveConfig()).resolves.toMatchObject({
      url: undefined,
    });
    await expect(service.getSettings()).resolves.toMatchObject({
      url: '',
      configured: true,
    });

    // Rows damaged outside the API degrade to safe defaults instead of failing.
    await repository.update(
      { key: 'serverManagement.url' },
      { value: 'not-a-url' },
    );
    await repository.update(
      { key: 'serverManagement.nodeId' },
      { value: 'bad id' },
    );
    const active = await service.getActiveConfig();
    expect(active.url).toBeUndefined();
    expect(active.nodeId).toBe('rustdesk');
    // The raw values stay visible so administrators can fix them.
    await expect(service.getSettings()).resolves.toMatchObject({
      url: 'not-a-url',
      nodeId: 'bad id',
    });
  });

  it('imports the legacy environment variables exactly once', async () => {
    const previous = {
      HBBS_MANAGEMENT_URL: process.env.HBBS_MANAGEMENT_URL,
      SERVER_MANAGEMENT_TOKEN: process.env.SERVER_MANAGEMENT_TOKEN,
      SERVER_MANAGEMENT_NODE_ID: process.env.SERVER_MANAGEMENT_NODE_ID,
      SERVER_MANAGEMENT_NODE_NAME: process.env.SERVER_MANAGEMENT_NODE_NAME,
    };
    process.env.HBBS_MANAGEMENT_URL = 'http://hbbs:21120';
    process.env.SERVER_MANAGEMENT_TOKEN = 'a'.repeat(40);
    process.env.SERVER_MANAGEMENT_NODE_ID = 'main';
    delete process.env.SERVER_MANAGEMENT_NODE_NAME;
    try {
      await expect(service.getActiveConfig()).resolves.toEqual({
        url: 'http://hbbs:21120',
        token: 'a'.repeat(40),
        nodeId: 'main',
        nodeName: 'RustDesk',
      });
      // The environment is ignored once the database holds a configuration.
      process.env.HBBS_MANAGEMENT_URL = 'http://elsewhere:21120';
      await expect(service.getActiveConfig()).resolves.toMatchObject({
        url: 'http://hbbs:21120',
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
