import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { AdminGuard } from '../../common/guards/admin.guard';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { UpdateGeneralSettingsDto } from './dto/general-settings.dto';
import { SystemSetting } from './entities/system-setting.entity';
import { GeneralSettingsController } from './general-settings.controller';
import { FrontendSettingsController } from './frontend-settings.controller';
import { GeneralSettingsService } from './services/general-settings.service';

const DEFAULT_SETTINGS = {
  watermarkEnabled: true,
  defaultLanguage: 'en-US',
  site: { frontendUrl: '', backendUrl: '' },
  webauthn: { enabled: true, rpName: 'RustDesk Console' },
};

describe('GeneralSettingsService', () => {
  let dataSource: DataSource;
  let repository: Repository<SystemSetting>;
  let service: GeneralSettingsService;

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
    service = new GeneralSettingsService(repository, dataSource);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('returns a compatible default for missing or malformed values', async () => {
    await expect(service.getSettings()).resolves.toEqual(DEFAULT_SETTINGS);

    await repository.save([
      repository.create({
        key: 'console.watermarkEnabled',
        value: 'invalid',
        category: 'console',
      }),
    ]);

    await expect(service.getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('stores the watermark setting and returns its effective value', async () => {
    await expect(
      service.updateSettings({
        watermarkEnabled: false,
      }),
    ).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      watermarkEnabled: false,
    });

    await expect(service.getSettings()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      watermarkEnabled: false,
    });
    await expect(repository.count()).resolves.toBe(6);
  });

  it('persists defaultLanguage and validates the format', async () => {
    await service.updateSettings({
      watermarkEnabled: true,
      defaultLanguage: 'pt-BR',
    });
    await expect(service.getSettings()).resolves.toMatchObject({
      defaultLanguage: 'pt-BR',
    });

    const invalid = plainToInstance(UpdateGeneralSettingsDto, {
      watermarkEnabled: true,
      defaultLanguage: 'english',
    });
    await expect(validate(invalid)).resolves.not.toHaveLength(0);

    const invalidCase = plainToInstance(UpdateGeneralSettingsDto, {
      watermarkEnabled: true,
      defaultLanguage: 'EN-us',
    });
    await expect(validate(invalidCase)).resolves.not.toHaveLength(0);
  });

  it('persists site and webauthn settings and reads them back', async () => {
    await service.updateSettings({
      watermarkEnabled: true,
      site: { frontendUrl: 'https://admin.example.com', backendUrl: '' },
      webauthn: { enabled: false, rpName: 'Custom RP' },
    });

    const settings = await service.getSettings();
    expect(settings.site.frontendUrl).toBe('https://admin.example.com');
    expect(settings.site.backendUrl).toBe('');
    expect(settings.webauthn.enabled).toBe(false);
    expect(settings.webauthn.rpName).toBe('Custom RP');
  });

  it('resolves effective backend url with fallback chain', async () => {
    await service.updateSettings({
      watermarkEnabled: true,
      site: { frontendUrl: 'https://front.example.com', backendUrl: '' },
    });
    const site = await service.getSiteSettings();
    expect(site.effectiveBackendUrl).toBe('https://front.example.com');

    await service.updateSettings({
      watermarkEnabled: true,
      site: {
        frontendUrl: 'https://front.example.com',
        backendUrl: 'https://back.example.com',
      },
    });
    const site2 = await service.getSiteSettings();
    expect(site2.effectiveBackendUrl).toBe('https://back.example.com');
  });

  it('returns a minimal frontend-only projection', async () => {
    await service.updateSettings({
      watermarkEnabled: false,
      defaultLanguage: 'zh-CN',
      webauthn: { enabled: true, rpName: 'RP' },
    });
    await expect(service.getFrontendSettings()).resolves.toEqual({
      watermarkEnabled: false,
      defaultLanguage: 'zh-CN',
      webauthnEnabled: true,
    });
  });
});

describe('general settings HTTP contract', () => {
  it('validates the update payload', async () => {
    const valid = plainToInstance(UpdateGeneralSettingsDto, {
      watermarkEnabled: false,
    });
    const invalid = plainToInstance(UpdateGeneralSettingsDto, {
      watermarkEnabled: 'false',
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    await expect(validate(invalid)).resolves.not.toHaveLength(0);
  });

  it('validates nested site and webauthn payloads', async () => {
    const valid = plainToInstance(UpdateGeneralSettingsDto, {
      watermarkEnabled: true,
      site: { frontendUrl: 'https://a.example.com', backendUrl: '' },
      webauthn: { enabled: true, rpName: 'RP' },
    });
    await expect(validate(valid)).resolves.toHaveLength(0);

    const invalidWebauthn = plainToInstance(UpdateGeneralSettingsDto, {
      watermarkEnabled: true,
      webauthn: { enabled: 'yes' },
    });
    await expect(validate(invalidWebauthn)).resolves.not.toHaveLength(0);
  });

  it('restricts general reads and updates to administrators', () => {
    const readHandler = Object.getOwnPropertyDescriptor(
      GeneralSettingsController.prototype,
      'getSettings',
    )?.value as (...args: unknown[]) => unknown;
    const updateHandler = Object.getOwnPropertyDescriptor(
      GeneralSettingsController.prototype,
      'updateSettings',
    )?.value as (...args: unknown[]) => unknown;

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, readHandler)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, readHandler)).toContain(
      AdminGuard,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, updateHandler)).toContain(
      AdminGuard,
    );
  });

  it('exposes frontend settings publicly', () => {
    const frontendHandler = Object.getOwnPropertyDescriptor(
      FrontendSettingsController.prototype,
      'getSettings',
    )?.value as (...args: unknown[]) => unknown;

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, frontendHandler)).toBe(true);
  });
});
