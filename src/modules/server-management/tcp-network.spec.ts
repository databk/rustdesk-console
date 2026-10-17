import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import {
  REQUIRE_PERMISSION_KEY,
  REQUIRE_SUPER_ADMIN_KEY,
} from '../rbac/decorators/require-permission.decorator';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';
import { ServerEventsService } from './server-events.service';
import type { ServerManagementRuntimeConfig } from './server-management-settings.service';
import { ServerManagementSettingsService } from './server-management-settings.service';
import { ServerManagementController } from './server-management.controller';
import { ServerManagementService } from './server-management.service';
import { unavailable } from '../../../network/tcp-observation.js';

jest.mock('uuid', () => ({
  v4: jest.requireActual<typeof import('node:crypto')>('node:crypto')
    .randomUUID,
}));

const settingsStub = (config: Partial<ServerManagementRuntimeConfig> = {}) =>
  ({
    getActiveConfig: () => ({
      url: config.url,
      token: config.token ?? '',
      nodeId: config.nodeId ?? 'rustdesk',
      nodeName: config.nodeName ?? 'RustDesk',
    }),
  }) as unknown as ServerManagementSettingsService;

describe('read-only TCP observations', () => {
  const audit = { record: jest.fn(), recordDenied: jest.fn() };
  const create = () =>
    new ServerManagementService(
      settingsStub({
        url: 'http://hbbs:21120',
        token: 'a'.repeat(40),
        nodeId: 'main',
      }),
      audit as unknown as RbacAuditService,
      new ServerEventsService(settingsStub()),
    );

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('uses servers.view and exposes no network write handler', () => {
    for (const method of [
      ServerManagementController.prototype.network,
      ServerManagementController.prototype.localNetwork,
    ]) {
      expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, method)).toEqual([
        'servers.view',
      ]);
      expect(
        Reflect.getMetadata(REQUIRE_SUPER_ADMIN_KEY, method),
      ).toBeUndefined();
    }
    expect('applyNetwork' in ServerManagementController.prototype).toBe(false);
    expect('applyTcpNetwork' in ServerManagementService.prototype).toBe(false);
  });

  it('reads the console runtime scope for the primary node', async () => {
    const service = create();
    const observer = (
      service as unknown as {
        observer: { system: (...args: unknown[]) => Promise<unknown> };
      }
    ).observer;
    const system = jest
      .spyOn(observer, 'system')
      .mockResolvedValue(unavailable('system', 'source_unavailable'));
    await service.networkSettings();
    await service.networkSettings('main');
    expect(system).toHaveBeenCalledTimes(2);
    expect(audit.record).not.toHaveBeenCalled();
    expect(audit.recordDenied).not.toHaveBeenCalled();
  });

  it('reports relay namespaces as unobservable instead of guessing', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.endsWith('/v1/relays'))
        return Promise.resolve(Response.json({ data: [{ id: 'relay-a' }] }));
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    const value = await create().networkSettings('relay-a');
    expect(value.status).toBe('unavailable');
    expect(value.reason).toBe('namespace_unobservable');
    await expect(create().networkSettings('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('observes only the local hbbr socket and never dials out', async () => {
    const service = create();
    const observer = (
      service as unknown as {
        observer: { connection: (...args: unknown[]) => Promise<unknown> };
      }
    ).observer;
    jest
      .spyOn(observer, 'connection')
      .mockResolvedValue(unavailable('connection', 'connection_not_found'));
    const mock = jest.spyOn(globalThis, 'fetch');
    const value = await service.relayConnection({
      local: { address: '127.0.0.1', port: 21119 },
      remote: { address: '127.0.0.1', port: 53000 },
    });
    expect(observer.connection).toHaveBeenCalledWith(
      expect.any(Object),
      'hbbr',
    );
    expect(value.status).toBe('unavailable');
    expect(value.reason).toBe('connection_not_found');
    expect(mock).not.toHaveBeenCalled();
    const identified = {
      ...unavailable('connection', 'source_unavailable'),
      status: 'identified',
      reason: null,
      algorithm: 'cubic',
    };
    jest.spyOn(observer, 'connection').mockResolvedValue(identified);
    await expect(
      service.relayConnection({
        local: { address: '127.0.0.1', port: 21119 },
        remote: { address: '127.0.0.1', port: 53001 },
      }),
    ).resolves.toMatchObject({ status: 'identified', algorithm: 'cubic' });
    expect(mock).not.toHaveBeenCalled();
  });
});
