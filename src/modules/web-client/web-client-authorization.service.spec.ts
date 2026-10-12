import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Peer, PeerStatus } from '../../common/entities/peer.entity';
import { Sysinfo } from '../../common/entities/sysinfo.entity';
import { DATABASE_ENTITIES } from '../../database/entities';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import { PeerService } from '../device-group/peer.service';
import { User, UserStatus } from '../user/entities/user.entity';
import { UserToken } from '../user/entities/user-token.entity';
import { Strategy } from '../strategy/entities/strategy.entity';
import { Role } from '../rbac/entities/role.entity';
import { RolePermission } from '../rbac/entities/role-permission.entity';
import { UserRoleAssignment } from '../rbac/entities/user-role-assignment.entity';
import { UserRoleAssignmentDeviceGroup } from '../rbac/entities/user-role-assignment-device-group.entity';
import { ConsoleAudit } from '../rbac/entities/console-audit.entity';
import { RbacAuthorizationService } from '../rbac/services/rbac-authorization.service';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';
import {
  WebClientAuthorizationService,
  normalizeWebClientTarget,
} from './web-client-authorization.service';

jest.mock('uuid', () => ({
  v4: jest.requireActual<typeof import('node:crypto')>('node:crypto')
    .randomUUID,
}));

describe('网页远控真实 SQLite 角色与设备范围', () => {
  let db: DataSource;
  let service: WebClientAuthorizationService;
  let authorization: RbacAuthorizationService;
  let peerService: PeerService;
  const actor = { id: 'actor', jti: 'login-1' };

  beforeAll(async () => {
    db = await new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: DATABASE_ENTITIES,
      synchronize: true,
    }).initialize();
    const audit = new RbacAuditService(db.getRepository(ConsoleAudit));
    authorization = new RbacAuthorizationService(
      db.getRepository(User),
      db.getRepository(RolePermission),
      db.getRepository(UserRoleAssignment),
      db.getRepository(UserRoleAssignmentDeviceGroup),
      db.getRepository(Peer),
      db.getRepository(DeviceGroup),
      audit,
      db.getRepository(Role),
    );
    service = new WebClientAuthorizationService(
      authorization,
      db.getRepository(Peer),
      db.getRepository(UserToken),
    );
    peerService = new PeerService(
      db.getRepository(Peer),
      db.getRepository(Sysinfo),
      db.getRepository(User),
      db.getRepository(Strategy),
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  beforeEach(async () => {
    for (const entity of [
      ConsoleAudit,
      UserRoleAssignmentDeviceGroup,
      UserRoleAssignment,
      RolePermission,
      Role,
      UserToken,
      Peer,
      Sysinfo,
      DeviceGroup,
      User,
    ])
      await db.getRepository(entity.name).clear();
    await db.getRepository(User).save({
      guid: actor.id,
      username: 'tester',
      status: UserStatus.ACTIVE,
      isAdmin: false,
    });
    await db.getRepository(UserToken).save({
      guid: 'token-1',
      userGuid: actor.id,
      jti: actor.jti,
      isRevoked: false,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await db.getRepository(DeviceGroup).save([
      { guid: 'A', name: 'A' },
      { guid: 'B', name: 'B' },
    ]);
    await peer('target', '123456789', 'A', actor.id);
  });

  async function peer(
    uuid: string,
    id: string,
    group: string | null,
    owner: string | null = null,
    status = PeerStatus.ACTIVE,
  ) {
    return db.getRepository(Peer).save({
      uuid,
      id,
      deviceGroupGuid: group,
      userGuid: owner,
      status,
      ver: 1040900,
      modifiedAt: 1,
      lastHeartbeat: new Date(),
    });
  }

  async function role(guid: string, permissions: string[], groups?: string[]) {
    await db.getRepository(Role).save({ guid, name: guid });
    await db.getRepository(RolePermission).save(
      permissions.map((permissionCode) => ({
        roleGuid: guid,
        permissionCode,
      })),
    );
    await db.getRepository(UserRoleAssignment).save({
      guid: `grant-${guid}`,
      userGuid: actor.id,
      roleGuid: guid,
      scopeType: groups ? 'device_group' : 'global',
    });
    if (groups)
      await db.getRepository(UserRoleAssignmentDeviceGroup).save(
        groups.map((deviceGroupGuid) => ({
          assignmentGuid: `grant-${guid}`,
          deviceGroupGuid,
        })),
      );
  }

  it('拥有设备而没有网页角色也拒绝，旧客户端 peers 仍可见自有设备', async () => {
    await expect(
      service.validate(actor, '123456789', 'desktop'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      (await peerService.getAccessiblePeers(actor.id, {})).data.map(
        (row) => row.guid,
      ),
    ).toEqual(['target']);
  });

  it('所有者从当前数据库身份获得全局授权，不要求自有设备或角色', async () => {
    await db.getRepository(User).update(actor.id, { isAdmin: true });
    await db.getRepository(Peer).update('target', { userGuid: null });
    expect((await service.validate(actor, '123456789', 'file')).peer.uuid).toBe(
      'target',
    );
  });

  it('只有管理查看权限不能网页远控', async () => {
    await role('view', ['devices.view']);
    await expect(
      service.validate(actor, '123456789', 'desktop'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('全局与组范围生效，精确 ID 不按包含匹配授权', async () => {
    await role('connect', ['web_client.connect'], ['A']);
    expect(
      (await service.validate(actor, '123456789', 'desktop')).peer.uuid,
    ).toBe('target');
    await peer('outside', '987654321', 'B', actor.id);
    await expect(
      service.validate(actor, '987654321', 'desktop'),
    ).rejects.toThrow('Web client target is not authorized');
    await expect(
      service.validate(actor, '12345678', 'desktop'),
    ).rejects.toThrow('Web client target is not authorized');
  });

  it('未登记、禁用、范围外和重号设备使用同一拒绝', async () => {
    await role('connect', ['web_client.connect'], ['A']);
    await peer('disabled', '234567890', 'A', null, PeerStatus.DISABLED);
    await peer('outside', '987654321', 'B');
    // 重号登记即使禁用且在角色范围外，也不能把另一个登记当唯一。
    await peer('duplicate', '123456789', 'B', null, PeerStatus.DISABLED);
    for (const target of ['111111111', '234567890', '987654321', '123456789'])
      await expect(service.validate(actor, target, 'desktop')).rejects.toThrow(
        'Web client target is not authorized',
      );
  });

  it('UUID 重新绑定不能借旧 grant 继续访问', async () => {
    await role('connect', ['web_client.connect']);
    await expect(
      service.validate(actor, '123456789', 'desktop', 'previous-uuid'),
    ).rejects.toThrow('Web client target is not authorized');
  });

  it('文件权限不能借另一角色的 connect 绕过同角色依赖', async () => {
    await role('connect', ['web_client.connect']);
    await role('invalid-files', ['web_client.file_transfer']);
    await expect(
      service.validate(actor, '123456789', 'file'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('文件权限必须同时覆盖同一目标组', async () => {
    await role('connect', ['web_client.connect'], ['A']);
    await role(
      'files',
      ['web_client.connect', 'web_client.file_transfer'],
      ['B'],
    );
    await expect(service.validate(actor, '123456789', 'file')).rejects.toThrow(
      'Web client target is not authorized',
    );
    await db
      .getRepository(UserRoleAssignmentDeviceGroup)
      .save({ assignmentGuid: 'grant-files', deviceGroupGuid: 'A' });
    expect((await service.validate(actor, '123456789', 'file')).peer.uuid).toBe(
      'target',
    );
  });

  it.each(['revoked', 'expired', 'disabled', 'role_removed'] as const)(
    '当前数据库 %s 立即使下一次授权复验失效',
    async (reason) => {
      await role('connect', ['web_client.connect']);
      if (reason === 'revoked')
        await db
          .getRepository(UserToken)
          .update('token-1', { isRevoked: true });
      if (reason === 'expired')
        await db
          .getRepository(UserToken)
          .update('token-1', { expiresAt: new Date(Date.now() - 1) });
      if (reason === 'disabled')
        await db
          .getRepository(User)
          .update(actor.id, { status: UserStatus.DISABLED });
      if (reason === 'role_removed')
        await db.getRepository(RolePermission).clear();
      await expect(
        service.validate(actor, '123456789', 'desktop'),
      ).rejects.toBeInstanceOf(
        reason === 'role_removed' ? ForbiddenException : UnauthorizedException,
      );
    },
  );

  it('专用列表在总数和分页前过滤组范围、ACTIVE 与全部重号，保留 peers shape', async () => {
    await role('connect', ['web_client.connect'], ['A']);
    await peer('sort-first-outside', '100000000', 'B', actor.id);
    await peer('valid-2', '234567890', 'A');
    await peer('disabled', '222222222', 'A', null, PeerStatus.DISABLED);
    await peer('duplicate-1', '333333333', 'A');
    await peer('duplicate-2', '333333333', 'B', null, PeerStatus.DISABLED);
    const scope = await service.requireScope(actor.id);
    const first = await peerService.getAccessiblePeers(
      actor.id,
      { pageSize: 1, current: 1 },
      false,
      scope,
    );
    expect(first.total).toBe(2);
    expect(first.data[0]).toMatchObject({
      id: '123456789',
      guid: 'target',
      is_online: true,
      info: { device_name: '', os: '' },
    });
    const second = await peerService.getAccessiblePeers(
      actor.id,
      { pageSize: 1, current: 2, is_online: '1' },
      false,
      scope,
    );
    expect(second.total).toBe(2);
    expect(second.data[0].guid).toBe('valid-2');
  });

  it('管理员断开需要 devices.disconnect 当前目标范围', async () => {
    await role('manager', ['devices.view', 'devices.disconnect'], ['B']);
    await expect(
      service.requireDisconnect(actor, 'target'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await db
      .getRepository(UserRoleAssignmentDeviceGroup)
      .save({ assignmentGuid: 'grant-manager', deviceGroupGuid: 'A' });
    await expect(
      service.requireDisconnect(actor, 'target'),
    ).resolves.toBeUndefined();
  });
});

describe('网页目标 ID 规范', () => {
  it.each([
    [' 123 456 789 ', '123456789'],
    ['Office_pc-1', 'Office_pc-1'],
    ['A中文测试设备', 'A中文测试设备'],
  ])('与 Worker 相同的有效 ID %s', (input, normalized) => {
    expect(normalizeWebClientTarget(input)).toBe(normalized);
  });
  it.each([
    '',
    '   ',
    '123?token=secret',
    'https://host',
    '123\n456',
    'x'.repeat(257),
  ])('拒绝无效输入 %s', (input) => {
    expect(() => normalizeWebClientTarget(input)).toThrow();
  });
});
