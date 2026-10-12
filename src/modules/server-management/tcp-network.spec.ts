import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import {
  REQUIRE_PERMISSION_KEY,
  REQUIRE_SUPER_ADMIN_KEY,
} from '../rbac/decorators/require-permission.decorator';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';
import { ServerManagementController } from './server-management.controller';
import { ServerManagementService } from './server-management.service';
import { unavailable } from '../../../network/tcp-observation.js';

jest.mock('uuid', () => ({
  v4: jest.requireActual<typeof import('node:crypto')>('node:crypto')
    .randomUUID,
}));
const node = {
  id: 'relay',
  name: 'Relay',
  url: 'http://agent:3001',
  token: 'a'.repeat(40),
};
describe('read-only TCP observations', () => {
  const audit = { record: jest.fn(), recordDenied: jest.fn() };
  const create = (extra: Record<string, string> = {}) =>
    new ServerManagementService(
      new ConfigService({ RUSTDESK_NODES: JSON.stringify([node]), ...extra }),
      audit as unknown as RbacAuditService,
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
  it('accepts arbitrary observed algorithms and never performs mutation/persistence/audit writes', async () => {
    const state = {
      ...unavailable('system', 'source_unavailable'),
      status: 'identified',
      reason: null,
      algorithm: 'vegas',
      algorithms: ['reno', 'cubic', 'vegas'],
      algorithms_verified: true,
    };
    const mock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(Response.json({ ...state, token: 'secret' }));
    const value = await create().networkSettings(node.id);
    expect(value.algorithm).toBe('vegas');
    expect(value).not.toHaveProperty('token');
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][1]?.method).toBe('GET');
    expect(audit.record).not.toHaveBeenCalled();
    expect(audit.recordDenied).not.toHaveBeenCalled();
  });
  it('rejects wrong-kind/old default responses and bounds malformed or oversized responses', async () => {
    const mock = jest.spyOn(global, 'fetch');
    const service = create();
    for (const value of [
      unavailable('connection', 'source_unavailable'),
      { scope: 'host_new_tcp_connections', current_algorithm: 'bbr' },
      { data: 'x'.repeat(40000) },
    ]) {
      mock.mockResolvedValueOnce(Response.json(value));
      expect((await service.networkSettings(node.id)).reason).toBe(
        'invalid_response',
      );
    }
  });
  it('does not reinterpret an unreachable agent as a BBR default and rejects unknown node IDs', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Offline'));
    const service = create();
    expect((await service.networkSettings(node.id)).algorithm).toBeNull();
    expect((await service.networkSettings(node.id)).reason).toBe(
      'source_unavailable',
    );
    await expect(service.networkSettings('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('does not associate an arbitrary sole node with a live relay connection', async () => {
    const service = create();
    const observer = (
      service as unknown as {
        observer: { connection: (...args: unknown[]) => Promise<unknown> };
      }
    ).observer;
    jest
      .spyOn(observer, 'connection')
      .mockResolvedValue(unavailable('connection', 'connection_not_found'));
    const mock = jest.spyOn(global, 'fetch');
    await service.relayConnection({
      local: { address: '127.0.0.1', port: 21119 },
      remote: { address: '127.0.0.1', port: 53000 },
    });
    expect(mock).not.toHaveBeenCalled();
    expect(observer.connection).toHaveBeenCalledWith(
      expect.any(Object),
      'hbbr',
    );
  });
  it('an explicitly associated enrolled agent reads only the bound relay sending tuple', async () => {
    const service = create({ WEB_CLIENT_TCP_RELAY_NODE_ID: node.id });
    const observer = (
      service as unknown as {
        observer: { connection: (...args: unknown[]) => Promise<unknown> };
      }
    ).observer;
    jest
      .spyOn(observer, 'connection')
      .mockResolvedValue(unavailable('connection', 'connection_not_found'));
    const observed = {
      ...unavailable('connection', 'source_unavailable'),
      status: 'identified',
      reason: null,
      algorithm: 'cubic',
    };
    const mock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(Response.json(observed));
    const value = await service.relayConnection({
      local: { address: '10.0.0.2', port: 21119 },
      remote: { address: '10.0.0.3', port: 53000 },
    });
    expect(value.algorithm).toBe('cubic');
    const url = new URL(mock.mock.calls[0][0] as string);
    expect(url.searchParams.get('local_address')).toBe('10.0.0.2');
    expect(url.searchParams.get('local_port')).toBe('21119');
    expect(mock.mock.calls[0][1]?.method).toBe('GET');
  });
});
