import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  UpdateCheckRequest,
  UpdateCheckResponse,
} from './dto/update-check.dto';
import { UpdateCheckService } from './update-check.service';

jest.mock('uuid', () => ({ v4: () => 'test-install-id' }));

const outdated: UpdateCheckResponse = {
  backend: { has_update: false },
  frontend: {
    has_update: true,
    version: '1.6.0',
    release_url:
      'https://github.com/databk/rustdesk-console-web/releases/tag/1.6.0',
    release_note: 'New frontend release',
    published_at: '2026-09-27T12:29:06Z',
  },
};
const upToDate: UpdateCheckResponse = {
  backend: { has_update: false },
  frontend: { has_update: false },
};

function response(data: UpdateCheckResponse): Response {
  return new Response(JSON.stringify(data), { status: 200 });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('UpdateCheckService version-aware cache', () => {
  let module: TestingModule;
  let service: UpdateCheckService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let payloadMock: jest.Mock;
  let settings: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    settings = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: unknown) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };
    module = await Test.createTestingModule({
      providers: [UpdateCheckService],
    })
      .useMocker(() => settings)
      .compile();
    service = module.get(UpdateCheckService);
    payloadMock = jest.fn((frontend?: string) =>
      Promise.resolve({
        version: { backend: '1.9.0', frontend: frontend || 'unknown' },
      } as UpdateCheckRequest),
    );
    jest
      .spyOn(service as any, 'buildRequestPayload')
      .mockImplementation(payloadMock);
    fetchMock = jest.spyOn(globalThis, 'fetch');
    fetchMock.mockRejectedValue(new Error('Unexpected update request'));
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await module.close();
    jest.restoreAllMocks();
  });

  async function initialize(
    version: string | undefined = '1.5.1',
    result = outdated,
  ) {
    settings.findOne.mockResolvedValueOnce(version ? { value: version } : null);
    fetchMock.mockResolvedValueOnce(response(result));
    await service.onModuleInit();
  }

  it('refreshes an old cached update before returning to an upgraded frontend', async () => {
    await initialize();
    fetchMock.mockResolvedValueOnce(response(upToDate));

    await expect(service.checkUpdate('1.6.0')).resolves.toEqual(upToDate);

    expect(settings.save).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'frontend_version', value: '1.6.0' }),
    );
    expect(payloadMock).toHaveBeenLastCalledWith('1.6.0');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reuses a successful cache for an unchanged frontend version', async () => {
    await initialize('1.6.0', upToDate);

    await expect(service.checkUpdate('1.6.0')).resolves.toEqual(upToDate);
    await expect(service.checkUpdate('1.6.0')).resolves.toEqual(upToDate);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(settings.save).not.toHaveBeenCalled();
  });

  it('makes concurrent callers await one refresh for the same version', async () => {
    await initialize();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);

    const first = service.checkUpdate('1.6.0');
    const second = service.checkUpdate('1.6.0');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending.resolve(response(upToDate));

    await expect(Promise.all([first, second])).resolves.toEqual([
      upToDate,
      upToDate,
    ]);
    expect(settings.save).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes the new version after an older scheduled check finishes', async () => {
    await initialize();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    fetchMock.mockResolvedValueOnce(response(upToDate));
    const scheduled = service.handleScheduledUpdateCheck();
    await flush();

    const upgraded = service.checkUpdate('1.6.0');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending.resolve(response(outdated));
    await scheduled;

    await expect(upgraded).resolves.toEqual(upToDate);
    expect(payloadMock).toHaveBeenLastCalledWith('1.6.0');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(['network', 'HTTP'])(
    'retries the same version after a %s failure',
    async (failure) => {
      await initialize();
      if (failure === 'network') {
        fetchMock.mockRejectedValueOnce(new Error('Network unavailable'));
      } else {
        fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
      }

      await expect(service.checkUpdate('1.6.0')).resolves.toEqual(outdated);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      fetchMock.mockResolvedValueOnce(response(upToDate));

      await expect(service.checkUpdate('1.6.0')).resolves.toEqual(upToDate);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );

  it('serializes version persistence for overlapping upgrades', async () => {
    await initialize();
    const firstSave = deferred<void>();
    settings.save.mockReturnValueOnce(firstSave.promise);
    fetchMock.mockResolvedValueOnce(response(upToDate));
    fetchMock.mockResolvedValueOnce(response(upToDate));

    const first = service.checkUpdate('1.6.0');
    const second = service.checkUpdate('1.7.0');
    await flush();
    expect(settings.save).toHaveBeenCalledTimes(1);
    firstSave.resolve();
    await Promise.all([first, second]);

    expect(settings.save.mock.calls.map(([setting]) => setting.value)).toEqual([
      '1.6.0',
      '1.7.0',
    ]);
    fetchMock.mockResolvedValueOnce(response(upToDate));
    await service.handleScheduledUpdateCheck();
    expect(payloadMock).toHaveBeenLastCalledWith('1.7.0');
  });

  it('allows another attempt after persisting a changed version fails', async () => {
    await initialize();
    settings.save.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(service.checkUpdate('1.6.0')).rejects.toThrow(
      'Database unavailable',
    );
    fetchMock.mockResolvedValueOnce(response(upToDate));

    await expect(service.checkUpdate('1.6.0')).resolves.toEqual(upToDate);
    expect(settings.save).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('supports startup and cached requests without a frontend version', async () => {
    settings.findOne.mockResolvedValue(null);
    fetchMock.mockResolvedValueOnce(response(upToDate));
    await service.onModuleInit();

    expect(payloadMock).toHaveBeenCalledWith(undefined);
    await expect(service.checkUpdate()).resolves.toEqual(upToDate);
    expect(settings.save).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
