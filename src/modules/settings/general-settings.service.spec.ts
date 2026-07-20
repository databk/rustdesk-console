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

  it('returns compatible defaults for missing or malformed values', async () => {
    await expect(service.getSettings()).resolves.toEqual({
      siteName: 'RustDesk Console',
      watermarkEnabled: true,
    });

    await repository.save([
      repository.create({
        key: 'console.siteName',
        value: 'bad\nname',
        category: 'console',
      }),
      repository.create({
        key: 'console.watermarkEnabled',
        value: 'invalid',
        category: 'console',
      }),
    ]);

    await expect(service.getSettings()).resolves.toEqual({
      siteName: 'RustDesk Console',
      watermarkEnabled: true,
    });
  });

  it('stores both settings together and returns their effective values', async () => {
    await expect(
      service.updateSettings({
        siteName: '  远程控制台  ',
        watermarkEnabled: false,
      }),
    ).resolves.toEqual({
      siteName: '远程控制台',
      watermarkEnabled: false,
    });

    await expect(service.getSettings()).resolves.toEqual({
      siteName: '远程控制台',
      watermarkEnabled: false,
    });
    await expect(repository.count()).resolves.toBe(2);
  });

  it('rolls back the site name when the watermark write fails', async () => {
    await dataSource.query(`
      CREATE TRIGGER fail_watermark
      BEFORE INSERT ON system_settings
      WHEN NEW.key = 'console.watermarkEnabled'
      BEGIN
        SELECT RAISE(ABORT, 'forced failure');
      END
    `);

    await expect(
      service.updateSettings({
        siteName: 'Atomic Console',
        watermarkEnabled: false,
      }),
    ).rejects.toThrow('forced failure');
    await expect(repository.count()).resolves.toBe(0);
  });
});

describe('general settings HTTP contract', () => {
  it('trims and validates the complete update payload', async () => {
    const valid = plainToInstance(UpdateGeneralSettingsDto, {
      siteName: '  控制台  ',
      watermarkEnabled: false,
    });
    const invalid = plainToInstance(UpdateGeneralSettingsDto, {
      siteName: 'invalid\nname',
      watermarkEnabled: 'false',
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(valid.siteName).toBe('控制台');
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
