import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { User } from '../modules/user/entities/user.entity';
import { DatabaseInitService } from './database-init.service';

jest.mock('uuid', () => {
  const cryptoModule =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { v4: cryptoModule.randomUUID };
});

describe('DatabaseInitService initial owner password', () => {
  const originalPassword = process.env.ADMIN_PASSWORD;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.ADMIN_PASSWORD;
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = originalPassword;
    jest.restoreAllMocks();
  });

  function createService(existingOwner?: Partial<User>) {
    const userRepository = {
      count: jest.fn().mockResolvedValue(existingOwner ? 1 : 0),
      findOne: jest.fn().mockResolvedValue(existingOwner ?? null),
      create: jest.fn((user: Partial<User>) => user),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const query = {
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    const service = new DatabaseInitService(
      userRepository as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      { createQueryBuilder: jest.fn().mockReturnValue(query) } as never,
      {
        initializeStorage: jest.fn().mockResolvedValue({ guid: 'default' }),
      } as never,
      {
        options: { type: 'sqlite' },
        query: jest.fn().mockResolvedValue(undefined),
      } as never,
    );
    return { service, userRepository };
  }

  it('hashes the configured password only when creating the first owner', async () => {
    const password = ' initial-owner-secret-sentinel ';
    process.env.ADMIN_PASSWORD = password;
    const { service, userRepository } = createService();

    await service.onModuleInit();

    const owner = userRepository.create.mock.calls[0][0];
    expect(owner).toMatchObject({
      username: 'databk',
      email: 'databk@github.com',
      isAdmin: true,
      userGroupGuid: 'default',
    });
    expect(await bcrypt.compare(password, owner.password!)).toBe(true);
    expect(bcrypt.getRounds(owner.password!)).toBe(10);
    expect(userRepository.save).toHaveBeenCalledTimes(1);
    expect(userRepository.save).toHaveBeenCalledWith(owner);
    expect(warn).not.toHaveBeenCalled();
    const logs = JSON.stringify([log.mock.calls, warn.mock.calls]);
    expect(logs).not.toContain(password.trim());
    expect(logs).not.toContain(owner.password);
  });

  it('retains the legacy fallback only when ADMIN_PASSWORD is absent', async () => {
    const { service, userRepository } = createService();

    await service.onModuleInit();

    const owner = userRepository.create.mock.calls[0][0];
    expect(await bcrypt.compare('databk', owner.password!)).toBe(true);
    expect(bcrypt.getRounds(owner.password!)).toBe(10);
    expect(userRepository.save).toHaveBeenCalledWith(owner);
    expect(warn).toHaveBeenCalledWith(
      'ADMIN_PASSWORD is not set; using the legacy default. Please change it immediately after first login!',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('databk');
  });

  it('rejects an explicitly empty password before creating an owner', async () => {
    process.env.ADMIN_PASSWORD = '';
    const { service, userRepository } = createService();

    await expect(service.onModuleInit()).rejects.toThrow(
      'ADMIN_PASSWORD must not be empty',
    );

    expect(userRepository.create).not.toHaveBeenCalled();
    expect(userRepository.save).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'replacement-secret-sentinel'])(
    'leaves an existing owner unchanged when ADMIN_PASSWORD is %p',
    async (password) => {
      if (password !== undefined) process.env.ADMIN_PASSWORD = password;
      const existingOwner = { guid: 'owner', password: 'existing-hash' };
      const { service, userRepository } = createService(existingOwner);

      await service.onModuleInit();

      expect(existingOwner.password).toBe('existing-hash');
      expect(userRepository.create).not.toHaveBeenCalled();
      expect(userRepository.save).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      const logs = JSON.stringify([log.mock.calls, warn.mock.calls]);
      expect(logs).not.toContain('replacement-secret-sentinel');
      expect(logs).not.toContain('existing-hash');
    },
  );
});

describe('DatabaseInitService owner startup guard', () => {
  function createService() {
    const userRepository = {
      count: jest.fn(),
    };
    const dataSource = {
      query: jest.fn().mockResolvedValue(undefined),
      options: { type: 'sqlite' as const },
    };
    const service = new DatabaseInitService(
      userRepository as never,
      undefined as never,
      undefined as never,
      {
        initializeStorage: jest.fn().mockResolvedValue({ guid: 'default' }),
      } as never,
      dataSource as never,
    );
    const internals = service as unknown as {
      createDefaultAdmin: jest.Mock;
      cleanupUnusedDefaultOidcProviders: jest.Mock;
      cleanupExpiredAuthStates: jest.Mock;
    };
    const createDefaultAdmin = (internals.createDefaultAdmin = jest.fn());
    const cleanupUnusedDefaultOidcProviders =
      (internals.cleanupUnusedDefaultOidcProviders = jest.fn());
    const cleanupExpiredAuthStates = (internals.cleanupExpiredAuthStates =
      jest.fn());
    return {
      service,
      userRepository,
      dataSource,
      createDefaultAdmin,
      cleanupUnusedDefaultOidcProviders,
      cleanupExpiredAuthStates,
    };
  }

  it.each([0, 1])('continues startup with %i owner(s)', async (owners) => {
    const context = createService();
    context.userRepository.count.mockResolvedValue(owners);

    await context.service.onModuleInit();

    expect(context.createDefaultAdmin).toHaveBeenCalledWith('default');
    expect(context.dataSource.query).toHaveBeenCalledWith(
      'CREATE UNIQUE INDEX IF NOT EXISTS UQ_users_single_owner ON users (isAdmin) WHERE isAdmin = 1',
    );
    expect(context.cleanupUnusedDefaultOidcProviders).toHaveBeenCalledTimes(1);
    expect(context.cleanupExpiredAuthStates).toHaveBeenCalledTimes(1);
  });

  it('rejects startup when legacy data contains multiple owners', async () => {
    const context = createService();
    context.userRepository.count.mockResolvedValue(2);

    await expect(context.service.onModuleInit()).rejects.toThrow(
      'Database contains 2 system owners',
    );
    expect(context.createDefaultAdmin).not.toHaveBeenCalled();
    expect(context.dataSource.query).not.toHaveBeenCalled();
    expect(context.cleanupUnusedDefaultOidcProviders).not.toHaveBeenCalled();
    expect(context.cleanupExpiredAuthStates).not.toHaveBeenCalled();
  });
});
