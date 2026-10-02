import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { REQUIRE_PERMISSION_KEY } from '../rbac/decorators/require-permission.decorator';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';
import { ServerManagementController } from './server-management.controller';
import { ServerManagementService } from './server-management.service';

const node = {
  id: 'local',
  name: 'Local server',
  url: 'http://agent:3001',
  token: 'a'.repeat(40),
};

describe('server management boundary', () => {
  const audit = { record: jest.fn(), recordDenied: jest.fn() };
  const create = (nodes: unknown = [node]) =>
    new ServerManagementService(
      new ConfigService({ RUSTDESK_NODES: JSON.stringify(nodes) }),
      audit as unknown as RbacAuditService,
    );

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('allows existing deployments with no configured nodes', async () => {
    expect(await create([]).list()).toEqual({ data: [] });
  });

  it('rejects duplicate nodes, credentials in URLs and weak tokens', () => {
    expect(() => create([node, node])).toThrow();
    expect(() =>
      create([{ ...node, url: 'http://user:password@agent' }]),
    ).toThrow();
    expect(() => create([{ ...node, token: 'short' }])).toThrow();
  });

  it('uses only registered origins and never exposes their credentials', async () => {
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ api_version: 1, node_id: 'local', services: [] }),
      );
    const service = create();
    const result = await service.list();
    expect(JSON.stringify(result)).not.toContain(node.token);
    expect(JSON.stringify(result)).not.toContain(node.url);
    expect(fetcher).toHaveBeenCalledWith(
      'http://agent:3001/v1/status',
      expect.objectContaining({
        redirect: 'error',
        headers: expect.objectContaining({
          authorization: `Bearer ${node.token}`,
        }),
      }),
    );
    await expect(service.request('other', '/v1/status')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('audits successful settings changes without logging setting values', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ state: 'saved' }));
    await create().mutate(
      'actor',
      'local',
      '/v1/services/hbbs/config',
      'PUT',
      { values: { key: 'private-key-material' } },
      { settings: ['key'] },
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ targetGuid: 'local', result: 'allowed' }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
      'private-key-material',
    );
  });

  it('does not report an applied operation as failed when audit persistence fails', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ state: 'applied' }));
    audit.record.mockRejectedValueOnce(new Error('Audit storage unavailable'));
    await expect(
      create().mutate('actor', 'local', '/v1/services/hbbs/apply', 'POST'),
    ).resolves.toEqual({ state: 'applied' });
  });

  it('reports offline nodes without inventing a stopped state', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline'));
    expect(await create().list()).toEqual({
      data: [{ id: 'local', name: node.name, reachable: false, services: [] }],
    });
  });

  it('requires global server permissions, not device permissions', () => {
    const prototype = ServerManagementController.prototype;
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.action),
    ).toEqual(['servers.control']);
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.saveConfig),
    ).toEqual(['servers.config']);
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.disconnect),
    ).toEqual(['servers.disconnect']);
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.saveBans),
    ).toEqual(['servers.ban']);
  });
});
