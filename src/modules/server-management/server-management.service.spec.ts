import { NotFoundException, ConflictException } from '@nestjs/common';
import { REQUIRE_PERMISSION_KEY } from '../rbac/decorators/require-permission.decorator';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';
import { ServerBanPolicy } from './entities/server-ban-policy.entity';
import { ServerNode } from './entities/server-node.entity';
import { ServerManagementController } from './server-management.controller';
import { ServerManagementService } from './server-management.service';

jest.mock('uuid', () => {
  const cryptoModule =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { v4: cryptoModule.randomUUID };
});

type MockRepo<T> = {
  find: jest.Mock;
  findOne: jest.Mock;
  count: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  remove: jest.Mock;
  update: jest.Mock;
};

function createMockRepo<T>(): MockRepo<T> {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    create: jest.fn((entity) => entity),
    save: jest.fn(async (entity) => entity),
    remove: jest.fn(async () => undefined),
    update: jest.fn(async () => undefined),
  };
}

const hbbsNode: ServerNode = {
  guid: 'hbbs-1',
  role: 'hbbs',
  name: 'Primary hbbs',
  url: 'http://hbbs:21120',
  managementToken: 'a'.repeat(40),
  status: 'online',
  lastCheckedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const hbbrNode: ServerNode = {
  guid: 'hbbr-1',
  role: 'hbbr',
  name: 'Primary hbbr',
  url: 'http://hbbr:21121',
  managementToken: 'b'.repeat(40),
  status: 'online',
  lastCheckedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('server management', () => {
  let nodeRepo: MockRepo<ServerNode>;
  let banPolicyRepo: MockRepo<ServerBanPolicy>;
  let audit: { record: jest.Mock; recordDenied: jest.Mock };
  let service: ServerManagementService;

  beforeEach(() => {
    nodeRepo = createMockRepo<ServerNode>();
    banPolicyRepo = createMockRepo<ServerBanPolicy>();
    audit = { record: jest.fn(), recordDenied: jest.fn() };
    service = new ServerManagementService(
      nodeRepo as never,
      banPolicyRepo as never,
      audit as unknown as RbacAuditService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('lists server nodes from the database', async () => {
    nodeRepo.find.mockResolvedValue([hbbsNode, hbbrNode]);
    const result = await service.list();
    expect(result.data).toHaveLength(2);
  });

  it('enforces at most one hbbs node', async () => {
    nodeRepo.count.mockResolvedValue(0);
    nodeRepo.findOne.mockResolvedValue(hbbsNode);
    await expect(
      service.create('hbbs', 'Second hbbs', 'http://hbbs2:21120', 'c'.repeat(40)),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('enforces a maximum node count', async () => {
    nodeRepo.count.mockResolvedValue(100);
    await expect(
      service.create('hbbr', 'Extra', 'http://hbbr2:21121', 'c'.repeat(40)),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects invalid URLs', async () => {
    nodeRepo.count.mockResolvedValue(0);
    await expect(
      service.create('hbbr', 'Bad', 'ftp://hbbr:21121', 'c'.repeat(40)),
    ).rejects.toThrow();
    await expect(
      service.create('hbbr', 'Bad', 'http://user:pass@hbbr:21121', 'c'.repeat(40)),
    ).rejects.toThrow();
  });

  it('creates a new hbbr node when no hbbs conflict', async () => {
    nodeRepo.count.mockResolvedValue(1);
    nodeRepo.findOne.mockResolvedValue(null);
    const result = await service.create(
      'hbbr',
      'New relay',
      'http://hbbr2:21121',
      'c'.repeat(40),
    );
    expect(result.role).toBe('hbbr');
    expect(nodeRepo.save).toHaveBeenCalled();
  });

  it('throws NotFound for unknown node guids', async () => {
    nodeRepo.findOne.mockResolvedValue(null);
    await expect(service.getNode('unknown')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('calls the server management API directly without an agent', async () => {
    nodeRepo.findOne.mockResolvedValue(hbbsNode);
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ api_version: 1, service: 'hbbs' }),
      );
    await service.getConfig('hbbs-1');
    expect(fetcher).toHaveBeenCalledWith(
      'http://hbbs:21120/v1/config',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: `Bearer ${hbbsNode.managementToken}`,
        }),
      }),
    );
  });

  it('never exposes management tokens in responses', async () => {
    nodeRepo.find.mockResolvedValue([hbbsNode]);
    const result = await service.list();
    expect(JSON.stringify(result)).not.toContain(hbbsNode.managementToken);
  });

  it('fans out ban policy to all registered nodes', async () => {
    nodeRepo.find.mockResolvedValue([hbbsNode, hbbrNode]);
    banPolicyRepo.findOne.mockResolvedValue(null);
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({}));
    const result = await service.applyBans('actor', {
      device_ids: ['dev1'],
      ips: ['192.0.2.1'],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith(
      'http://hbbs:21120/v1/bans',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      'http://hbbr:21121/v1/bans',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(result.synchronization).toHaveLength(2);
    expect(result.synchronization.every((s) => s.state === 'applied')).toBe(true);
  });

  it('reports pending synchronization for unreachable nodes', async () => {
    nodeRepo.find.mockResolvedValue([hbbsNode, hbbrNode]);
    banPolicyRepo.findOne.mockResolvedValue(null);
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(Response.json({}));
    const result = await service.applyBans('actor', {
      device_ids: [],
      ips: [],
    });
    expect(result.synchronization).toEqual([
      { guid: 'hbbs-1', role: 'hbbs', state: 'pending' },
      { guid: 'hbbr-1', role: 'hbbr', state: 'applied' },
    ]);
  });

  it('audits successful mutations without logging setting values', async () => {
    nodeRepo.findOne.mockResolvedValue(hbbsNode);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ state: 'saved' }),
    );
    await service.saveConfig('actor', 'hbbs-1', {
      values: { key: 'private-key-material' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ targetGuid: 'hbbs-1', result: 'allowed' }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
      'private-key-material',
    );
  });

  it('records denied audit when server operation fails', async () => {
    nodeRepo.findOne.mockResolvedValue(hbbsNode);
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Down'));
    await expect(
      service.saveConfig('actor', 'hbbs-1', { values: {} }),
    ).rejects.toThrow();
    expect(audit.recordDenied).toHaveBeenCalledWith(
      expect.objectContaining({ targetGuid: 'hbbs-1' }),
    );
  });

  it('requires global server permissions', () => {
    const prototype = ServerManagementController.prototype;
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.create),
    ).toEqual(['servers.manage']);
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.update),
    ).toEqual(['servers.manage']);
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.remove),
    ).toEqual(['servers.manage']);
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
