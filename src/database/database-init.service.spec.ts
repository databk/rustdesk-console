import 'reflect-metadata';
import { DatabaseInitService } from './database-init.service';

jest.mock('uuid', () => {
  const cryptoModule =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { v4: cryptoModule.randomUUID };
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
      createDefaultOidcProviders: jest.Mock;
      cleanupExpiredAuthStates: jest.Mock;
    };
    const createDefaultAdmin = (internals.createDefaultAdmin = jest.fn());
    const createDefaultOidcProviders = (internals.createDefaultOidcProviders =
      jest.fn());
    const cleanupExpiredAuthStates = (internals.cleanupExpiredAuthStates =
      jest.fn());
    return {
      service,
      userRepository,
      dataSource,
      createDefaultAdmin,
      createDefaultOidcProviders,
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
    expect(context.createDefaultOidcProviders).toHaveBeenCalledTimes(1);
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
    expect(context.createDefaultOidcProviders).not.toHaveBeenCalled();
    expect(context.cleanupExpiredAuthStates).not.toHaveBeenCalled();
  });
});
