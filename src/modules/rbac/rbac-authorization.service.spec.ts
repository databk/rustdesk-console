import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Peer } from '../../common/entities/peer.entity';
import { AuditsController } from '../audit/audit.controller';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import { DeviceGroupController } from '../device-group/device-group.controller';
import { User, UserStatus } from '../user/entities/user.entity';
import { PermissionController } from './permission.controller';
import { PERMISSION_CATALOG } from './constants/permission-catalog';
import { REQUIRE_SUPER_ADMIN_KEY } from './decorators/require-permission.decorator';
import { ConsoleAudit } from './entities/console-audit.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRoleAssignment } from './entities/user-role-assignment.entity';
import { UserRoleAssignmentDeviceGroup } from './entities/user-role-assignment-device-group.entity';
import { RbacAuditService } from './services/rbac-audit.service';
import { RbacAuthorizationService } from './services/rbac-authorization.service';
import { RoleService } from './services/role.service';
import { UserRoleService } from './services/user-role.service';

jest.mock('uuid', () => {
  const cryptoModule =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { v4: cryptoModule.randomUUID };
});

type MockRepository = {
  findOne: jest.Mock;
  find: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  exist: jest.Mock;
};

const repository = (): MockRepository => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((value) => value),
  save: jest.fn((value) => value),
  exist: jest.fn(),
});

describe('RbacAuthorizationService', () => {
  let userRepository: MockRepository;
  let rolePermissionRepository: MockRepository;
  let assignmentRepository: MockRepository;
  let assignmentGroupRepository: MockRepository;
  let peerRepository: MockRepository;
  let deviceGroupRepository: MockRepository;
  let auditService: { recordDenied: jest.Mock };
  let service: RbacAuthorizationService;

  const activeUser = {
    guid: 'actor',
    status: UserStatus.ACTIVE,
    isAdmin: false,
  } as User;

  beforeEach(() => {
    userRepository = repository();
    rolePermissionRepository = repository();
    assignmentRepository = repository();
    assignmentGroupRepository = repository();
    peerRepository = repository();
    deviceGroupRepository = repository();
    auditService = { recordDenied: jest.fn().mockResolvedValue(undefined) };
    userRepository.findOne.mockResolvedValue(activeUser);
    assignmentRepository.find.mockResolvedValue([]);
    rolePermissionRepository.find.mockResolvedValue([]);
    assignmentGroupRepository.find.mockResolvedValue([]);
    peerRepository.find.mockResolvedValue([]);
    service = new RbacAuthorizationService(
      userRepository as unknown as Repository<User>,
      rolePermissionRepository as unknown as Repository<RolePermission>,
      assignmentRepository as unknown as Repository<UserRoleAssignment>,
      assignmentGroupRepository as unknown as Repository<UserRoleAssignmentDeviceGroup>,
      peerRepository as unknown as Repository<Peer>,
      deviceGroupRepository as unknown as Repository<DeviceGroup>,
      auditService as unknown as RbacAuditService,
    );
  });

  it('rejects disabled users before reading role grants', async () => {
    userRepository.findOne.mockResolvedValue({
      ...activeUser,
      status: UserStatus.DISABLED,
    });

    await expect(
      service.requirePermission('actor', 'devices.view'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(assignmentRepository.find).not.toHaveBeenCalled();
  });

  it('applies a device-group grant and never treats it as global', async () => {
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'device_group' },
    ]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'devices.view' },
    ]);
    assignmentGroupRepository.find.mockResolvedValue([
      { assignmentGuid: 'assignment-1', deviceGroupGuid: 'group-1' },
    ]);

    await expect(
      service.getPermissionScope('actor', 'devices.view'),
    ).resolves.toEqual({
      global: false,
      deviceGroupGuids: new Set(['group-1']),
    });
  });

  it('makes a global grant win over narrower grants for the same action', async () => {
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'device_group' },
      { guid: 'assignment-2', roleGuid: 'role-2', scopeType: 'global' },
    ]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'devices.view' },
      { roleGuid: 'role-2', permissionCode: 'devices.view' },
    ]);

    await expect(
      service.getPermissionScope('actor', 'devices.view'),
    ).resolves.toEqual({
      global: true,
      deviceGroupGuids: new Set(),
    });
    expect(assignmentGroupRepository.find).not.toHaveBeenCalled();
  });

  it('ignores a damaged device-group grant for a global-only action', async () => {
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'device_group' },
    ]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'users.edit' },
    ]);
    assignmentGroupRepository.find.mockResolvedValue([
      { assignmentGuid: 'assignment-1', deviceGroupGuid: 'group-1' },
    ]);

    await expect(
      service.requirePermission('actor', 'users.edit'),
    ).rejects.toThrow('无权限访问');
    expect(assignmentGroupRepository.find).not.toHaveBeenCalled();
  });

  it('rejects direct and batch access outside the selected groups', async () => {
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'device_group' },
    ]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'devices.delete' },
    ]);
    assignmentGroupRepository.find.mockResolvedValue([
      { assignmentGuid: 'assignment-1', deviceGroupGuid: 'group-1' },
    ]);
    peerRepository.findOne.mockResolvedValue({
      uuid: 'peer-2',
      deviceGroupGuid: 'group-2',
    });

    await expect(
      service.assertDeviceAccess('actor', 'devices.delete', 'peer-2'),
    ).rejects.toThrow('设备不在授权设备组内');

    peerRepository.find.mockResolvedValue([
      { uuid: 'peer-1', deviceGroupGuid: 'group-1' },
      { uuid: 'peer-2', deviceGroupGuid: 'group-2' },
    ] as Peer[]);
    await expect(
      service.assertDevicesAccess('actor', 'devices.delete', [
        'peer-1',
        'peer-2',
      ]),
    ).rejects.toThrow('批量请求包含未授权设备');
    expect(auditService.recordDenied).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserGuid: 'actor',
        targetType: 'device',
        targetGuid: 'peer-2',
        action: 'devices.delete',
      }),
    );
  });

  it('reflects role revocation on the next authorization request', async () => {
    assignmentRepository.find
      .mockResolvedValueOnce([
        { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'global' },
      ])
      .mockResolvedValueOnce([]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'strategies.view' },
    ]);

    await expect(
      service.requirePermission('actor', 'strategies.view'),
    ).resolves.toEqual({ global: true, deviceGroupGuids: new Set() });
    await expect(
      service.requirePermission('actor', 'strategies.view'),
    ).rejects.toThrow('无权限访问');
  });

  it('requires a separate permission for sensitive fields on user updates', async () => {
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'global' },
    ]);
    rolePermissionRepository.find.mockImplementation(({ where }) =>
      where.permissionCode === 'users.edit'
        ? [{ roleGuid: 'role-1', permissionCode: 'users.edit' }]
        : [],
    );
    userRepository.findOne
      .mockResolvedValueOnce(activeUser)
      .mockResolvedValueOnce(activeUser)
      .mockResolvedValueOnce({ guid: 'target', isAdmin: false });

    await expect(
      service.assertUserMutation('actor', 'target', 'users.edit', {
        status: UserStatus.DISABLED,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rolePermissionRepository.find).toHaveBeenCalled();
  });

  it('requires global scope for strategy assignment to a user', async () => {
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'device_group' },
    ]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'strategies.assign' },
    ]);
    assignmentGroupRepository.find.mockResolvedValue([
      { assignmentGuid: 'assignment-1', deviceGroupGuid: 'group-1' },
    ]);

    await expect(
      service.assertStrategyTargets('actor', 'user', ['user-1']),
    ).rejects.toThrow('按用户分配策略需要全局权限');
  });

  it('protects administrator users from global strategy assignment', async () => {
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'global' },
    ]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'strategies.assign' },
    ]);
    userRepository.find.mockResolvedValue([
      { guid: 'protected-user', isAdmin: true },
    ]);

    await expect(
      service.assertStrategyTargets('actor', 'user', ['protected-user']),
    ).rejects.toThrow('需要超级管理员权限');
    expect(auditService.recordDenied).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserGuid: 'actor',
        targetGuid: 'protected-user',
        action: 'super_admin',
      }),
    );
  });

  it('protects administrator users on alternate batch mutation paths', async () => {
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'global' },
    ]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'user_groups.membership' },
    ]);
    userRepository.find.mockResolvedValue([
      { guid: 'protected-user', isAdmin: true },
    ]);

    await expect(
      service.assertUsersMutation(
        'actor',
        ['protected-user'],
        'user_groups.membership',
      ),
    ).rejects.toThrow('需要超级管理员权限');
  });

  it('does not expose unknown persisted permission rows as effective grants', async () => {
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'global' },
    ]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'future.admin' },
      { roleGuid: 'role-1', permissionCode: 'devices.view' },
    ]);

    const result = await service.getEffectivePermissions('actor');
    expect(result.permissions).toEqual(['devices.view']);
    expect(result.scopes['future.admin']).toBeUndefined();
    expect(
      PERMISSION_CATALOG.map((permission) => permission.code),
    ).not.toContain('future.admin');
  });
});

describe('UserRoleService', () => {
  it('does not present global-only role permissions as device-group grants', async () => {
    const userRepository = repository();
    const roleRepository = repository();
    const rolePermissionRepository = repository();
    const assignmentRepository = repository();
    const assignmentGroupRepository = repository();
    const deviceGroupRepository = repository();
    userRepository.exist.mockResolvedValue(true);
    assignmentRepository.find.mockResolvedValue([
      {
        guid: 'assignment-1',
        userGuid: 'user-1',
        roleGuid: 'role-1',
        scopeType: 'device_group',
      },
    ]);
    roleRepository.find.mockResolvedValue([
      { guid: 'role-1', name: 'Device operator' },
    ] as Role[]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'devices.view' },
      { roleGuid: 'role-1', permissionCode: 'users.edit' },
    ]);
    assignmentGroupRepository.find.mockResolvedValue([
      { assignmentGuid: 'assignment-1', deviceGroupGuid: 'group-1' },
    ]);

    const service = new UserRoleService(
      userRepository as unknown as Repository<User>,
      roleRepository as unknown as Repository<Role>,
      rolePermissionRepository as unknown as Repository<RolePermission>,
      assignmentRepository as unknown as Repository<UserRoleAssignment>,
      assignmentGroupRepository as unknown as Repository<UserRoleAssignmentDeviceGroup>,
      deviceGroupRepository as unknown as Repository<DeviceGroup>,
      {} as DataSource,
      {} as RbacAuditService,
      {} as RbacAuthorizationService,
    );

    const result = await service.getUserRoles('user-1');
    expect(result.data[0].permissions).toEqual(['devices.view']);
    expect(result.effective_scope).toEqual({
      'devices.view': {
        scope_type: 'device_group',
        device_group_guids: ['group-1'],
      },
    });
  });
});

describe('RoleService', () => {
  it('does not add global-only permissions to a role with scoped assignments', async () => {
    const roleRepository = repository();
    const rolePermissionRepository = repository();
    const assignmentRepository = repository();
    const assignmentGroupRepository = repository();
    roleRepository.findOne.mockResolvedValue({ guid: 'role-1' });
    assignmentRepository.exist.mockResolvedValue(true);
    const transaction = jest.fn();
    const service = new RoleService(
      roleRepository as unknown as Repository<Role>,
      rolePermissionRepository as unknown as Repository<RolePermission>,
      assignmentRepository as unknown as Repository<UserRoleAssignment>,
      assignmentGroupRepository as unknown as Repository<UserRoleAssignmentDeviceGroup>,
      { transaction } as unknown as DataSource,
      {} as RbacAuditService,
      {
        requireSuperAdmin: jest.fn().mockResolvedValue(undefined),
      } as unknown as RbacAuthorizationService,
    );

    await expect(
      service.replaceRolePermissions('role-1', ['users.edit'], 'actor'),
    ).rejects.toThrow('已有高级范围授权');
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('RbacAuditService', () => {
  it('redacts credentials before they are persisted', async () => {
    const auditRepository = repository();
    const service = new RbacAuditService(
      auditRepository as unknown as Repository<ConsoleAudit>,
    );

    await service.record({
      actorUserGuid: 'actor',
      targetType: 'role',
      action: 'role.update',
      result: 'allowed',
      afterState: {
        password: 'secret',
        nested: { token: 'jwt', visible: true },
      },
    });

    expect(auditRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        afterState: JSON.stringify({
          password: '[REDACTED]',
          nested: { token: '[REDACTED]', visible: true },
        }),
      }),
    );
  });

  it('keeps connection-audit mutation super-admin-only', () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_SUPER_ADMIN_KEY,
        AuditsController.prototype.updateConnectionAudit,
      ),
    ).toBe(true);
  });

  it('keeps the catalog protected while exposing only the caller effective grants', () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_SUPER_ADMIN_KEY,
        PermissionController.prototype.getPermissions,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        REQUIRE_SUPER_ADMIN_KEY,
        PermissionController.prototype.getMyPermissions,
      ),
    ).toBeUndefined();
  });
});

describe('DeviceGroupController current-state authorization', () => {
  const query = { current: 1, pageSize: 20 };

  const createController = () => {
    const deviceGroupService = {
      getAccessibleDeviceGroups: jest.fn(),
      getDevices: jest.fn(),
    };
    const authorizationService = {
      getCurrentUser: jest.fn().mockResolvedValue({ isAdmin: true }),
      getPermissionScope: jest.fn().mockResolvedValue({
        global: true,
        deviceGroupGuids: new Set<string>(),
      }),
    };
    return {
      controller: new DeviceGroupController(
        deviceGroupService as never,
        {} as never,
        {} as never,
        {} as never,
        authorizationService as never,
      ),
      deviceGroupService,
      authorizationService,
    };
  };

  it('uses the current database admin flag for the protected group list', async () => {
    const { controller, deviceGroupService, authorizationService } =
      createController();

    await controller.getDeviceGroups('actor', query);

    expect(authorizationService.getCurrentUser).toHaveBeenCalledWith('actor');
    expect(deviceGroupService.getAccessibleDeviceGroups).toHaveBeenCalledWith(
      'actor',
      query,
      true,
    );
  });

  it('uses only the current RBAC scope for the delegated device list', async () => {
    const { controller, deviceGroupService, authorizationService } =
      createController();

    await controller.getDevices('actor', query);

    const scope =
      await authorizationService.getPermissionScope.mock.results[0].value;
    expect(deviceGroupService.getDevices).toHaveBeenCalledWith(
      'actor',
      query,
      true,
      scope,
    );
  });
});
