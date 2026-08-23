import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { AdminGuard } from '../../common/guards/admin.guard';
import { UpdateAuditSettingsDto } from './dto/audit-settings.dto';
import { SystemSetting } from './entities/system-setting.entity';
import { AuditSettingsController } from './audit-settings.controller';
import { AuditSettingsService } from './services/audit-settings.service';

describe('AuditSettingsService', () => {
  let dataSource: DataSource;
  let repository: Repository<SystemSetting>;
  let service: AuditSettingsService;

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
    service = new AuditSettingsService(repository);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('returns 0 by default', async () => {
    await expect(service.getRetentionDays()).resolves.toBe(0);
  });

  it('persists retention days and reads them back', async () => {
    await service.setRetentionDays(30);
    await expect(service.getRetentionDays()).resolves.toBe(30);

    const setting = await repository.findOne({
      where: { key: 'audit.retentionDays' },
    });
    expect(setting).not.toBeNull();
    expect(setting!.value).toBe('30');
    expect(setting!.category).toBe('audit');
  });

  it('overwrites the existing value on subsequent sets', async () => {
    await service.setRetentionDays(7);
    await service.setRetentionDays(90);
    await expect(service.getRetentionDays()).resolves.toBe(90);
    await expect(repository.count()).resolves.toBe(1);
  });

  it('falls back to default for malformed stored values', async () => {
    await repository.save([
      repository.create({
        key: 'audit.retentionDays',
        value: 'not-a-number',
        category: 'audit',
      }),
    ]);
    await expect(service.getRetentionDays()).resolves.toBe(0);
  });

  it('allows 0 to disable cleanup', async () => {
    await service.setRetentionDays(0);
    await expect(service.getRetentionDays()).resolves.toBe(0);
  });
});

describe('audit settings HTTP contract', () => {
  let dataSource: DataSource;
  let repository: Repository<SystemSetting>;
  let service: AuditSettingsService;
  let controller: AuditSettingsController;

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
    service = new AuditSettingsService(repository);
    controller = new AuditSettingsController(service);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('GET returns the current retention days', async () => {
    await service.setRetentionDays(14);
    await expect(controller.getSettings()).resolves.toEqual({
      retentionDays: 14,
    });
  });

  it('PUT updates the retention days', async () => {
    await controller.updateSettings({ retentionDays: 60 });
    await expect(service.getRetentionDays()).resolves.toBe(60);
  });

  it('validates retentionDays must be a non-negative integer', async () => {
    const valid = plainToInstance(UpdateAuditSettingsDto, {
      retentionDays: 30,
    });
    await expect(validate(valid)).resolves.toHaveLength(0);

    const validZero = plainToInstance(UpdateAuditSettingsDto, {
      retentionDays: 0,
    });
    await expect(validate(validZero)).resolves.toHaveLength(0);

    const invalidNegative = plainToInstance(UpdateAuditSettingsDto, {
      retentionDays: -1,
    });
    await expect(validate(invalidNegative)).resolves.not.toHaveLength(0);

    const invalidFloat = plainToInstance(UpdateAuditSettingsDto, {
      retentionDays: 3.5,
    });
    await expect(validate(invalidFloat)).resolves.not.toHaveLength(0);

    const invalidString = plainToInstance(UpdateAuditSettingsDto, {
      retentionDays: '30',
    });
    await expect(validate(invalidString)).resolves.not.toHaveLength(0);
  });

  it('restricts reads and updates to administrators', () => {
    const readHandler = Object.getOwnPropertyDescriptor(
      AuditSettingsController.prototype,
      'getSettings',
    )?.value as (...args: unknown[]) => unknown;
    const updateHandler = Object.getOwnPropertyDescriptor(
      AuditSettingsController.prototype,
      'updateSettings',
    )?.value as (...args: unknown[]) => unknown;

    expect(Reflect.getMetadata(GUARDS_METADATA, readHandler)).toContain(
      AdminGuard,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, updateHandler)).toContain(
      AdminGuard,
    );
  });
});