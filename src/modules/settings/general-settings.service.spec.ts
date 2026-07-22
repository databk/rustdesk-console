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
import { GeneralSettingsService } from './services/general-settings.service';

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
    await expect(service.getSettings()).resolves.toEqual({
      watermarkEnabled: true,
    });

    await repository.save([
      repository.create({
        key: 'console.watermarkEnabled',
        value: 'invalid',
        category: 'console',
      }),
    ]);

    await expect(service.getSettings()).resolves.toEqual({
      watermarkEnabled: true,
    });
  });

  it('stores the watermark setting and returns its effective value', async () => {
    await expect(
      service.updateSettings({
        watermarkEnabled: false,
      }),
    ).resolves.toEqual({
      watermarkEnabled: false,
    });

    await expect(service.getSettings()).resolves.toEqual({
      watermarkEnabled: false,
    });
    await expect(repository.count()).resolves.toBe(1);
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

  it('keeps reads public and updates administrator-only', () => {
    const readHandler = Object.getOwnPropertyDescriptor(
      GeneralSettingsController.prototype,
      'getSettings',
    )?.value as (...args: unknown[]) => unknown;
    const updateHandler = Object.getOwnPropertyDescriptor(
      GeneralSettingsController.prototype,
      'updateSettings',
    )?.value as (...args: unknown[]) => unknown;

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, readHandler)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, updateHandler)).toContain(
      AdminGuard,
    );
  });
});
