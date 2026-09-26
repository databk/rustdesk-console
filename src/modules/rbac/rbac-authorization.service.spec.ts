import 'reflect-metadata';
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { DataSource, Repository } from 'typeorm';
import { Peer } from '../../common/entities/peer.entity';
import { AuditsController } from '../audit/audit.controller';
import { DashboardController } from '../dashboard/dashboard.controller';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import { DeviceGroupController } from '../device-group/device-group.controller';
import { DeviceStatus } from '../device-group/dto/device-status.dto';
import { DeviceGroupService } from '../device-group/device-group.service';
import { UserGroupController } from '../user-group/user-group.controller';
import { User, UserStatus } from '../user/entities/user.entity';
import { PermissionController } from './permission.controller';
import { PERMISSION_CATALOG } from './constants/permission-catalog';
import {
  REQUIRE_PERMISSION_KEY,
  REQUIRE_SUPER_ADMIN_KEY,
} from './decorators/require-permission.decorator';
import { ConsoleAudit } from './entities/console-audit.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRoleAssignment } from './entities/user-role-assignment.entity';
import { UserRoleAssignmentDeviceGroup } from './entities/user-role-assignment-device-group.entity';
import { RbacGuard } from './guards/rbac.guard';
import { RoleController } from './role.controller';
import { RbacAuditService } from './services/rbac-audit.service';
import { RbacAuthorizationService } from './services/rbac-authorization.service';
import { RoleService } from './services/role.service';
import { UserRoleService } from './services/user-role.service';
import { UserRoleController } from './user-role.controller';

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
  let roleRepository: MockRepository;
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
    roleRepository = repository();
    auditService = { recordDenied: jest.fn().mockResolvedValue(undefined) };
    userRepository.findOne.mockResolvedValue(activeUser);
    assignmentRepository.find.mockResolvedValue([]);
    rolePermissionRepository.find.mockResolvedValue([]);
    assignmentGroupRepository.find.mockResolvedValue([]);
    roleRepository.find.mockResolvedValue([]);
    peerRepository.find.mockResolvedValue([]);
    service = new RbacAuthorizationService(
      userRepository as unknown as Repository<User>,
      rolePermissionRepository as unknown as Repository<RolePermission>,
      assignmentRepository as unknown as Repository<UserRoleAssignment>,
      assignmentGroupRepository as unknown as Repository<UserRoleAssignmentDeviceGroup>,
      peerRepository as unknown as Repository<Peer>,
      deviceGroupRepository as unknown as Repository<DeviceGroup>,
      auditService as unknown as RbacAuditService,
      roleRepository as unknown as Repository<Role>,
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

  it('uses the transaction manager for target protection rechecks', async () => {
    const managerUserRepository = repository();
    const managerAssignmentRepository = repository();
    const managerRoleRepository = repository();
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === User
          ? managerUserRepository
          : entity === UserRoleAssignment
            ? managerAssignmentRepository
            : managerRoleRepository,
      ),
    };
    managerUserRepository.findOne
      .mockResolvedValueOnce({
        guid: 'actor',
        status: UserStatus.ACTIVE,
        isAdmin: false,
      })
      .mockResolvedValueOnce({ guid: 'target', isAdmin: false });
    managerAssignmentRepository.find.mockResolvedValue([]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'actor-role', permissionCode: 'users.edit' },
    ]);
    await expect(
      service.assertUserMutation(
        'actor',
        'target',
        'users.edit',
        undefined,
        manager as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(managerUserRepository.findOne).toHaveBeenCalled();
    expect(userRepository.findOne).not.toHaveBeenCalled();
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
    ).rejects.toThrow('Access denied');
    expect(assignmentGroupRepository.find).not.toHaveBeenCalled();
  });

  it('rejects direct and batch access outside the selected groups', async () => {
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'device_group' },
    ]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'devices.view' },
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
    ).rejects.toThrow('Device is not in an authorized device group');

    peerRepository.find.mockResolvedValue([
      { uuid: 'peer-1', deviceGroupGuid: 'group-1' },
      { uuid: 'peer-2', deviceGroupGuid: 'group-2' },
    ] as Peer[]);
    await expect(
      service.assertDevicesAccess('actor', 'devices.delete', [
        'peer-1',
        'peer-2',
      ]),
    ).rejects.toThrow('Batch request contains unauthorized devices');
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
    ).rejects.toThrow('Access denied');
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
    ).rejects.toThrow(
      'Assigning strategies by user requires global permission',
    );
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
    ).rejects.toThrow('Super administrator permission required');
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
      { roleGuid: 'role-1', permissionCode: 'user_groups.view' },
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
    ).rejects.toThrow('Super administrator permission required');
  });

  it('does not expose unknown persisted permission rows as effective grants', async () => {
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'global' },
    ]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'future.admin' },
      { roleGuid: 'role-1', permissionCode: 'roles.create' },
      { roleGuid: 'role-1', permissionCode: 'devices.view' },
    ]);

    const result = await service.getEffectivePermissions('actor');
    expect(result.permissions).toEqual(['devices.view']);
    expect(result.scopes['future.admin']).toBeUndefined();
    expect(result.scopes['roles.create']).toBeUndefined();
    expect(
      PERMISSION_CATALOG.map((permission) => permission.code),
    ).not.toContain('future.admin');
  });

  it('fails closed when a persisted write permission lacks its same-role view dependency', async () => {
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'global' },
      { guid: 'assignment-2', roleGuid: 'role-2', scopeType: 'global' },
    ]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'users.edit' },
      { roleGuid: 'role-2', permissionCode: 'users.view' },
    ]);

    await expect(
      service.requirePermission('actor', 'users.edit'),
    ).rejects.toThrow('Access denied');
    await expect(service.getEffectivePermissions('actor')).resolves.toEqual({
      permissions: ['users.view'],
      scopes: {
        'users.view': {
          scope_type: 'global',
          device_group_guids: [],
        },
      },
    });
  });

  it('keeps a persisted write permission effective when its dependency is in the same role', async () => {
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'global' },
    ]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'users.view' },
      { roleGuid: 'role-1', permissionCode: 'users.edit' },
    ]);

    await expect(
      service.requirePermission('actor', 'users.edit'),
    ).resolves.toEqual({ global: true, deviceGroupGuids: new Set() });
  });

  it('does not expose a damaged scoped assignment with no device groups', async () => {
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'device_group' },
    ]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'devices.view' },
    ]);

    await expect(service.getEffectivePermissions('actor')).resolves.toEqual({
      permissions: [],
      scopes: {},
    });
  });

  it('lets missing strategy device groups reach the established partial-error path', async () => {
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'device_group' },
    ]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'strategies.assign' },
    ]);
    assignmentGroupRepository.find.mockResolvedValue([
      { assignmentGuid: 'assignment-1', deviceGroupGuid: 'group-1' },
    ]);
    deviceGroupRepository.find.mockResolvedValue([{ guid: 'group-1' }]);

    await expect(
      service.assertStrategyTargets('actor', 'device_group', [
        'group-1',
        'missing-group',
      ]),
    ).resolves.toEqual({
      global: false,
      deviceGroupGuids: new Set(['group-1']),
    });
  });

  it('rejects an existing out-of-scope strategy device group', async () => {
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'device_group' },
    ]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'strategies.assign' },
    ]);
    assignmentGroupRepository.find.mockResolvedValue([
      { assignmentGuid: 'assignment-1', deviceGroupGuid: 'group-1' },
    ]);
    deviceGroupRepository.find.mockResolvedValue([{ guid: 'group-2' }]);

    await expect(
      service.assertStrategyTargets('actor', 'device_group', ['group-2']),
    ).rejects.toThrow('Target device group is outside the authorized scope');
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

  it('returns the agreed role eligibility scope contract', async () => {
    const userRepository = repository();
    const roleRepository = repository();
    const rolePermissionRepository = repository();
    const assignmentRepository = repository();
    const deviceGroupRepository = repository();
    userRepository.findOne.mockResolvedValue({
      guid: 'target',
      isAdmin: false,
    });
    roleRepository.find.mockResolvedValue([
      { guid: 'device-role', name: 'Device role', protectedAccount: false },
      { guid: 'global-role', name: 'Global role', protectedAccount: false },
      { guid: 'mixed-role', name: 'Mixed role', protectedAccount: false },
    ]);
    assignmentRepository.find.mockResolvedValue([]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'device-role', permissionCode: 'devices.view' },
      { roleGuid: 'global-role', permissionCode: 'users.view' },
      { roleGuid: 'mixed-role', permissionCode: 'devices.view' },
      { roleGuid: 'mixed-role', permissionCode: 'users.view' },
    ]);
    deviceGroupRepository.find.mockResolvedValue([
      { guid: 'group-1', name: 'Group 1' },
      { guid: 'group-2', name: 'Group 2' },
    ]);
    const eligibilityService = new UserRoleService(
      userRepository as unknown as Repository<User>,
      roleRepository as unknown as Repository<Role>,
      rolePermissionRepository as unknown as Repository<RolePermission>,
      assignmentRepository as unknown as Repository<UserRoleAssignment>,
      repository() as unknown as Repository<UserRoleAssignmentDeviceGroup>,
      deviceGroupRepository as unknown as Repository<DeviceGroup>,
      {} as DataSource,
      {} as RbacAuditService,
      {
        getCurrentUser: jest.fn().mockResolvedValue({ isAdmin: true }),
        getEffectivePermissions: jest.fn(),
        isProtectedUser: jest.fn().mockResolvedValue(false),
      } as unknown as RbacAuthorizationService,
    );
    const result = await eligibilityService.getRoleEligibility(
      'target',
      'owner',
    );
    expect(result.data.map((role) => role.allowed_scope_types)).toEqual([
      ['global', 'device_group'],
      ['global'],
      ['global'],
    ]);
    expect(result.data[0].assignable_device_groups).toEqual([
      { guid: 'group-1', name: 'Group 1' },
      { guid: 'group-2', name: 'Group 2' },
    ]);

    userRepository.findOne.mockResolvedValue({
      guid: 'owner',
      isAdmin: true,
    });
    const ownerTarget = await eligibilityService.getRoleEligibility(
      'owner',
      'owner',
    );
    expect(
      ownerTarget.data.every(
        (role) =>
          role.reason_code === 'super_admin_target' &&
          !role.can_assign &&
          !role.can_remove,
      ),
    ).toBe(true);
  });

  it('computes delegated scope types and group intersections from effective grants', async () => {
    const userRepository = repository();
    const roleRepository = repository();
    const rolePermissionRepository = repository();
    const assignmentRepository = repository();
    const deviceGroupRepository = repository();
    userRepository.findOne.mockResolvedValue({
      guid: 'target',
      isAdmin: false,
    });
    roleRepository.find.mockResolvedValue([
      { guid: 'group-role', name: 'Group role', protectedAccount: false },
      {
        guid: 'global-device-role',
        name: 'Device role',
        protectedAccount: false,
      },
      { guid: 'mixed-role', name: 'Mixed role', protectedAccount: false },
      { guid: 'empty-role', name: 'Empty role', protectedAccount: false },
      {
        guid: 'no-overlap-role',
        name: 'No overlap role',
        protectedAccount: false,
      },
    ] as Role[]);
    assignmentRepository.find.mockResolvedValue([]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'group-role', permissionCode: 'devices.view' },
      { roleGuid: 'global-device-role', permissionCode: 'devices.view' },
      { roleGuid: 'mixed-role', permissionCode: 'devices.view' },
      { roleGuid: 'mixed-role', permissionCode: 'users.view' },
      { roleGuid: 'no-overlap-role', permissionCode: 'devices.view' },
      { roleGuid: 'no-overlap-role', permissionCode: 'strategies.assign' },
    ]);
    deviceGroupRepository.find.mockResolvedValue([
      { guid: 'group-1', name: 'Group 1' },
      { guid: 'group-2', name: 'Group 2' },
    ]);
    const authorizationService = {
      getCurrentUser: jest.fn().mockResolvedValue({ isAdmin: false }),
      getEffectivePermissions: jest.fn().mockResolvedValue({
        permissions: ['devices.view', 'users.view'],
        scopes: {
          'devices.view': {
            scope_type: 'device_group',
            device_group_guids: ['group-1'],
          },
          'users.view': {
            scope_type: 'global',
            device_group_guids: [],
          },
          'strategies.assign': {
            scope_type: 'device_group',
            device_group_guids: ['group-2'],
          },
        },
      }),
      isProtectedUser: jest.fn().mockResolvedValue(false),
    };
    const eligibilityService = new UserRoleService(
      userRepository as unknown as Repository<User>,
      roleRepository as unknown as Repository<Role>,
      rolePermissionRepository as unknown as Repository<RolePermission>,
      assignmentRepository as unknown as Repository<UserRoleAssignment>,
      repository() as unknown as Repository<UserRoleAssignmentDeviceGroup>,
      deviceGroupRepository as unknown as Repository<DeviceGroup>,
      {} as DataSource,
      {} as RbacAuditService,
      authorizationService as unknown as RbacAuthorizationService,
    );

    const result = await eligibilityService.getRoleEligibility(
      'target',
      'delegated-actor',
    );

    expect(
      Object.fromEntries(
        result.data.map((role) => [
          role.name,
          {
            can_assign: role.can_assign,
            reason_code: role.reason_code,
            allowed_scope_types: role.allowed_scope_types,
            assignable_device_groups: role.assignable_device_groups,
          },
        ]),
      ),
    ).toEqual({
      'Device role': {
        can_assign: true,
        reason_code: null,
        allowed_scope_types: ['device_group'],
        assignable_device_groups: [{ guid: 'group-1', name: 'Group 1' }],
      },
      'Empty role': {
        can_assign: false,
        reason_code: 'scope_exceeds_caller',
        allowed_scope_types: [],
        assignable_device_groups: [],
      },
      'Group role': {
        can_assign: true,
        reason_code: null,
        allowed_scope_types: ['device_group'],
        assignable_device_groups: [{ guid: 'group-1', name: 'Group 1' }],
      },
      'Mixed role': {
        can_assign: false,
        reason_code: 'scope_exceeds_caller',
        allowed_scope_types: [],
        assignable_device_groups: [],
      },
      'No overlap role': {
        can_assign: false,
        reason_code: 'scope_exceeds_caller',
        allowed_scope_types: [],
        assignable_device_groups: [],
      },
    });

    authorizationService.getEffectivePermissions.mockResolvedValue({
      permissions: ['devices.view', 'users.view'],
      scopes: {
        'devices.view': { scope_type: 'global', device_group_guids: [] },
        'users.view': { scope_type: 'global', device_group_guids: [] },
      },
    });
    const globallyCovered = await eligibilityService.getRoleEligibility(
      'target',
      'delegated-actor',
    );
    const deviceRole = globallyCovered.data.find(
      (role) => role.name === 'Device role',
    );
    expect(deviceRole).toMatchObject({
      allowed_scope_types: ['global', 'device_group'],
      assignable_device_groups: [
        { guid: 'group-1', name: 'Group 1' },
        { guid: 'group-2', name: 'Group 2' },
      ],
    });
  });

  it('reports stable self, protected-target, and locked-role reasons', async () => {
    const userRepository = repository();
    const roleRepository = repository();
    const rolePermissionRepository = repository();
    const assignmentRepository = repository();
    const deviceGroupRepository = repository();
    userRepository.findOne.mockResolvedValue({
      guid: 'target',
      isAdmin: false,
    });
    roleRepository.find.mockResolvedValue([
      {
        guid: 'protected-role',
        name: 'Protected role',
        protectedAccount: true,
      },
      { guid: 'assign-role', name: 'Assign role', protectedAccount: false },
    ] as Role[]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'protected-role', permissionCode: 'users.view' },
      { roleGuid: 'assign-role', permissionCode: 'roles.assign' },
      { roleGuid: 'assign-role', permissionCode: 'roles.view' },
      { roleGuid: 'assign-role', permissionCode: 'users.view' },
    ]);
    assignmentRepository.find.mockResolvedValue([]);
    deviceGroupRepository.find.mockResolvedValue([]);
    const authorizationService = {
      getCurrentUser: jest.fn().mockResolvedValue({ isAdmin: false }),
      getEffectivePermissions: jest.fn().mockResolvedValue({
        permissions: ['users.view', 'roles.assign'],
        scopes: {
          'users.view': { scope_type: 'global', device_group_guids: [] },
          'roles.assign': { scope_type: 'global', device_group_guids: [] },
        },
      }),
      isProtectedUser: jest.fn().mockResolvedValue(true),
    };
    const eligibilityService = new UserRoleService(
      userRepository as unknown as Repository<User>,
      roleRepository as unknown as Repository<Role>,
      rolePermissionRepository as unknown as Repository<RolePermission>,
      assignmentRepository as unknown as Repository<UserRoleAssignment>,
      repository() as unknown as Repository<UserRoleAssignmentDeviceGroup>,
      deviceGroupRepository as unknown as Repository<DeviceGroup>,
      {} as DataSource,
      {} as RbacAuditService,
      authorizationService as unknown as RbacAuthorizationService,
    );

    const protectedResult = await eligibilityService.getRoleEligibility(
      'target',
      'delegated-actor',
    );
    expect(
      protectedResult.data.every(
        (role) =>
          role.reason_code === 'protected_target' &&
          !role.can_assign &&
          !role.can_remove &&
          role.allowed_scope_types.length === 0,
      ),
    ).toBe(true);

    authorizationService.isProtectedUser.mockResolvedValue(false);
    const lockedResult = await eligibilityService.getRoleEligibility(
      'target',
      'delegated-actor',
    );
    expect(lockedResult.data.map((role) => role.reason_code)).toEqual([
      'protected_role',
      'role_grants_roles_assign',
    ]);
    const selfResult = await eligibilityService.getRoleEligibility(
      'target',
      'target',
    );
    expect(
      selfResult.data.every((role) => role.reason_code === 'self_target'),
    ).toBe(true);
  });

  it('rejects assigning an empty role to device-group scope', async () => {
    const userRepository = repository();
    const roleRepository = repository();
    const rolePermissionRepository = repository();
    const authorizationService = {
      requireSuperAdmin: jest.fn().mockResolvedValue(undefined),
      getCurrentUser: jest.fn().mockResolvedValue({ isAdmin: true }),
      requirePermission: jest.fn().mockResolvedValue({
        global: true,
        deviceGroupGuids: new Set<string>(),
      }),
      isProtectedUser: jest.fn().mockResolvedValue(false),
    };
    userRepository.exist.mockResolvedValue(true);
    roleRepository.find.mockResolvedValue([{ guid: 'empty-role' }] as Role[]);
    rolePermissionRepository.find.mockResolvedValue([]);
    const transaction = jest.fn();
    const service = new UserRoleService(
      userRepository as unknown as Repository<User>,
      roleRepository as unknown as Repository<Role>,
      rolePermissionRepository as unknown as Repository<RolePermission>,
      repository() as unknown as Repository<UserRoleAssignment>,
      repository() as unknown as Repository<UserRoleAssignmentDeviceGroup>,
      repository() as unknown as Repository<DeviceGroup>,
      { transaction } as unknown as DataSource,
      {} as RbacAuditService,
      authorizationService as unknown as RbacAuthorizationService,
    );

    await expect(
      service.replaceUserRoles(
        'user-1',
        {
          assignments: [
            {
              role_guid: 'empty-role',
              scope_type: 'device_group',
              device_group_guids: ['group-1'],
            },
          ],
        },
        'actor',
      ),
    ).rejects.toThrow('device_group scope only supports');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('classifies an empty device-group assignment as invalid input', async () => {
    const service = new UserRoleService(
      repository() as unknown as Repository<User>,
      repository() as unknown as Repository<Role>,
      repository() as unknown as Repository<RolePermission>,
      repository() as unknown as Repository<UserRoleAssignment>,
      repository() as unknown as Repository<UserRoleAssignmentDeviceGroup>,
      repository() as unknown as Repository<DeviceGroup>,
      { transaction: jest.fn() } as unknown as DataSource,
      {} as RbacAuditService,
      {} as RbacAuthorizationService,
    );

    await expect(
      service.replaceUserRoles(
        'user-1',
        {
          assignments: [
            {
              role_guid: 'role-1',
              scope_type: 'device_group',
              device_group_guids: [],
            },
          ],
        },
        'actor',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects ordinary role assignments for the virtual super administrator', async () => {
    const userRepository = repository();
    userRepository.exist.mockResolvedValue(true);
    userRepository.findOne.mockResolvedValue({ guid: 'owner', isAdmin: true });
    const transaction = jest.fn();
    const service = new UserRoleService(
      userRepository as unknown as Repository<User>,
      repository() as unknown as Repository<Role>,
      repository() as unknown as Repository<RolePermission>,
      repository() as unknown as Repository<UserRoleAssignment>,
      repository() as unknown as Repository<UserRoleAssignmentDeviceGroup>,
      repository() as unknown as Repository<DeviceGroup>,
      { transaction } as unknown as DataSource,
      {} as RbacAuditService,
      {
        getCurrentUser: jest.fn().mockResolvedValue({ isAdmin: true }),
      } as unknown as RbacAuthorizationService,
    );

    await expect(
      service.replaceUserRoles('owner', { assignments: [] }, 'owner'),
    ).rejects.toThrow('Super administrators cannot be assigned regular roles');
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('RoleService', () => {
  it('omits ineffective damaged permissions from role list summaries', async () => {
    const roleRepository = repository();
    const rolePermissionRepository = repository();
    const builder = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest
        .fn()
        .mockResolvedValue([[{ guid: 'role-1', name: 'Damaged role' }], 1]),
    };
    Object.assign(roleRepository, {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
    });
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'users.edit' },
      { roleGuid: 'role-1', permissionCode: 'strategies.assign' },
    ]);
    const service = new RoleService(
      roleRepository as unknown as Repository<Role>,
      rolePermissionRepository as unknown as Repository<RolePermission>,
      repository() as unknown as Repository<UserRoleAssignment>,
      repository() as unknown as Repository<UserRoleAssignmentDeviceGroup>,
      {} as DataSource,
      {} as RbacAuditService,
      {} as RbacAuthorizationService,
    );

    await expect(
      service.listRoles({
        current: 1,
        pageSize: 20,
        name: 'Damaged',
        note: 'test note',
      }),
    ).resolves.toMatchObject({
      data: [{ permissions: ['strategies.assign'] }],
      total: 1,
    });
    expect(builder.andWhere).toHaveBeenNthCalledWith(
      1,
      'role.name LIKE :name',
      { name: '%Damaged%' },
    );
    expect(builder.andWhere).toHaveBeenNthCalledWith(
      2,
      'role.note LIKE :note',
      { note: '%test note%' },
    );
  });

  it('rejects role permissions whose view dependency is missing', async () => {
    const roleRepository = repository();
    const rolePermissionRepository = repository();
    const assignmentRepository = repository();
    const assignmentGroupRepository = repository();
    roleRepository.findOne.mockResolvedValue({ guid: 'role-1' });
    rolePermissionRepository.find.mockResolvedValue([]);
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
      service.updateRole('role-1', { permissions: ['users.edit'] }, 'actor'),
    ).rejects.toThrow('Missing permission dependencies');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects system-only role capabilities in ordinary role payloads', async () => {
    const roleRepository = repository();
    roleRepository.findOne.mockResolvedValue({ guid: 'role-1' });
    const transaction = jest.fn();
    const service = new RoleService(
      roleRepository as unknown as Repository<Role>,
      repository() as unknown as Repository<RolePermission>,
      repository() as unknown as Repository<UserRoleAssignment>,
      repository() as unknown as Repository<UserRoleAssignmentDeviceGroup>,
      { transaction } as unknown as DataSource,
      {} as RbacAuditService,
      {
        requireSuperAdmin: jest.fn().mockResolvedValue(undefined),
      } as unknown as RbacAuthorizationService,
    );

    await expect(
      service.updateRole('role-1', { permissions: ['roles.create'] }, 'owner'),
    ).rejects.toThrow('Permission code cannot be assigned: roles.create');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not add global-only permissions to a role with scoped assignments', async () => {
    const roleRepository = repository();
    const rolePermissionRepository = repository();
    const assignmentRepository = repository();
    const assignmentGroupRepository = repository();
    roleRepository.findOne.mockResolvedValue({ guid: 'role-1' });
    rolePermissionRepository.find.mockResolvedValue([]);
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
      service.updateRole(
        'role-1',
        { permissions: ['users.view', 'users.edit'] },
        'actor',
      ),
    ).rejects.toThrow('Roles with advanced scope grants');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not empty a role that still has scoped assignments', async () => {
    const roleRepository = repository();
    const rolePermissionRepository = repository();
    const assignmentRepository = repository();
    roleRepository.findOne.mockResolvedValue({ guid: 'role-1' });
    rolePermissionRepository.find.mockResolvedValue([]);
    assignmentRepository.exist.mockResolvedValue(true);
    const transaction = jest.fn();
    const service = new RoleService(
      roleRepository as unknown as Repository<Role>,
      rolePermissionRepository as unknown as Repository<RolePermission>,
      assignmentRepository as unknown as Repository<UserRoleAssignment>,
      repository() as unknown as Repository<UserRoleAssignmentDeviceGroup>,
      { transaction } as unknown as DataSource,
      {} as RbacAuditService,
      {
        requireSuperAdmin: jest.fn().mockResolvedValue(undefined),
      } as unknown as RbacAuthorizationService,
    );

    await expect(
      service.updateRole('role-1', { permissions: [] }, 'actor'),
    ).rejects.toThrow('Roles with advanced scope grants');
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
        otpCode: '123456',
        recoveryCode: 'recovery-code',
        nested: { token: 'jwt', visible: true },
      },
    });

    expect(auditRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        afterState: JSON.stringify({
          password: '[REDACTED]',
          otpCode: '[REDACTED]',
          recoveryCode: '[REDACTED]',
          nested: { token: '[REDACTED]', visible: true },
        }),
      }),
    );
  });

  it('rejects date-only values normalized to a different calendar date', () => {
    const service = new RbacAuditService({} as Repository<ConsoleAudit>);

    expect(() =>
      (
        service as unknown as { parseDate(value: string, field: string): Date }
      ).parseDate('2026-02-30', 'start_time'),
    ).toThrow(BadRequestException);
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
        REQUIRE_PERMISSION_KEY,
        PermissionController.prototype.getPermissions,
      ),
    ).toEqual(['roles.view']);
    expect(
      Reflect.getMetadata(
        REQUIRE_SUPER_ADMIN_KEY,
        PermissionController.prototype.getMyPermissions,
      ),
    ).toBeUndefined();
    expect(
      new PermissionController({} as RbacAuthorizationService)
        .getPermissions()
        .data.find((permission) => permission.code === 'devices.edit'),
    ).toMatchObject({ requires: ['devices.view'] });
    expect(
      PERMISSION_CATALOG.find(
        (permission) => permission.code === 'strategies.assign',
      )?.requires,
    ).toBeUndefined();
    expect(
      new PermissionController({} as RbacAuthorizationService)
        .getPermissions()
        .data.filter((permission) => permission.resource === 'roles'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'roles.view',
          assignable: true,
          system_only: false,
        }),
        expect.objectContaining({
          code: 'roles.assign',
          assignable: true,
          system_only: false,
        }),
        expect.objectContaining({
          code: 'roles.create',
          assignable: false,
          system_only: true,
        }),
        expect.objectContaining({
          code: 'roles.edit',
          assignable: false,
          system_only: true,
        }),
        expect.objectContaining({
          code: 'roles.delete',
          assignable: false,
          system_only: true,
        }),
      ]),
    );
  });

  it('keeps global dashboard aggregates super-administrator-only', () => {
    expect(
      Reflect.getMetadata(REQUIRE_SUPER_ADMIN_KEY, DashboardController),
    ).toBe(true);
  });

  it('separates delegated role viewing/assignment from owner-only definitions', () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        RoleController.prototype.list,
      ),
    ).toEqual(['roles.view']);
    expect(
      Reflect.getMetadata(
        REQUIRE_SUPER_ADMIN_KEY,
        RoleController.prototype.create,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        UserRoleController.prototype.replaceRoles,
      ),
    ).toEqual(['roles.assign']);
  });

  it('allows group reads without granting membership changes', () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        UserGroupController.prototype.getGroupUsers,
      ),
    ).toEqual(['user_groups.view']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        UserGroupController.prototype.moveUsers,
      ),
    ).toEqual(['user_groups.membership']);
  });
});

describe('RbacGuard', () => {
  const context = {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'actor' }, id: 'request-1' }),
    }),
  };

  it('executes the declared permission check', async () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === REQUIRE_PERMISSION_KEY ? ['devices.view'] : undefined,
      ),
    };
    const authorizationService = {
      requirePermission: jest.fn().mockResolvedValue({
        global: true,
        deviceGroupGuids: new Set<string>(),
      }),
      requireSuperAdmin: jest.fn(),
    };
    const auditService = { recordDenied: jest.fn() };
    const guard = new RbacGuard(
      reflector as never,
      authorizationService as never,
      auditService as never,
    );

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(authorizationService.requirePermission).toHaveBeenCalledWith(
      'actor',
      'devices.view',
    );
    expect(auditService.recordDenied).not.toHaveBeenCalled();
  });

  it('records one route denial when the permission check fails', async () => {
    const denial = new ForbiddenException('Access denied');
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === REQUIRE_PERMISSION_KEY ? ['devices.delete'] : undefined,
      ),
    };
    const authorizationService = {
      requirePermission: jest.fn().mockRejectedValue(denial),
      requireSuperAdmin: jest.fn(),
    };
    const auditService = {
      recordDenied: jest.fn().mockResolvedValue(undefined),
    };
    const guard = new RbacGuard(
      reflector as never,
      authorizationService as never,
      auditService as never,
    );

    await expect(guard.canActivate(context as never)).rejects.toBe(denial);
    expect(auditService.recordDenied).toHaveBeenCalledTimes(1);
    expect(auditService.recordDenied).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserGuid: 'actor',
        action: 'devices.delete',
        requestId: 'request-1',
      }),
    );
  });
});

describe('DeviceGroupController current-state authorization', () => {
  const query = { current: 1, pageSize: 20 };

  const createController = () => {
    const deviceGroupService = {
      getAccessibleDeviceGroups: jest.fn(),
      getDevices: jest.fn(),
    };
    const heartbeatService = {
      getActiveConnectionIds: jest.fn(),
    };
    const disconnectStoreService = {
      addPendingDisconnects: jest.fn(),
    };
    const authorizationService = {
      getCurrentUser: jest.fn().mockResolvedValue({ isAdmin: true }),
      getPermissionScope: jest.fn().mockResolvedValue({
        global: true,
        deviceGroupGuids: new Set<string>(),
      }),
      assertDeviceAccess: jest.fn().mockResolvedValue(undefined),
    };
    return {
      controller: new DeviceGroupController(
        deviceGroupService as never,
        heartbeatService as never,
        disconnectStoreService as never,
        {} as never,
        authorizationService as never,
      ),
      deviceGroupService,
      heartbeatService,
      disconnectStoreService,
      authorizationService,
    };
  };

  it('uses the current strategy-assignment scope for group candidates', async () => {
    const { controller, deviceGroupService, authorizationService } =
      createController();

    await controller.getStrategyTargetDeviceGroups('actor', query);

    const scope =
      await authorizationService.getPermissionScope.mock.results[0].value;
    expect(deviceGroupService.getAccessibleDeviceGroups).toHaveBeenCalledWith(
      'actor',
      query,
      true,
      scope,
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

  it('rejects an out-of-scope disconnect before inspecting or queueing it', async () => {
    const {
      controller,
      heartbeatService,
      disconnectStoreService,
      authorizationService,
    } = createController();
    const denial = new ForbiddenException(
      'Device is not in an authorized device group',
    );
    authorizationService.assertDeviceAccess.mockRejectedValue(denial);

    await expect(
      controller.disconnectDevice('peer-2', { connIds: [123] }, 'actor'),
    ).rejects.toBe(denial);

    expect(authorizationService.assertDeviceAccess).toHaveBeenCalledWith(
      'actor',
      'devices.disconnect',
      'peer-2',
    );
    expect(heartbeatService.getActiveConnectionIds).not.toHaveBeenCalled();
    expect(disconnectStoreService.addPendingDisconnects).not.toHaveBeenCalled();
  });

  it('separates the admin group list from scoped strategy target candidates', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        DeviceGroupController.prototype.getDeviceGroups,
      ),
    ).toEqual(expect.arrayContaining([expect.any(Function)]));
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        DeviceGroupController.prototype.getStrategyTargetDeviceGroups,
      ),
    ).toEqual(['strategies.assign']);
  });
});

describe('DeviceGroupService delegated management query', () => {
  it('intersects an exact requested device group with the current RBAC scope', async () => {
    const builder = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const peerRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
    };
    const service = new DeviceGroupService(
      {} as never,
      {} as never,
      peerRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.getDevices(
      'actor',
      { current: 1, pageSize: 20, device_group_guid: 'group-1' },
      false,
      {
        global: false,
        deviceGroupGuids: new Set(['group-1', 'group-2']),
      },
    );

    expect(builder.andWhere).toHaveBeenCalledWith(
      'peer.deviceGroupGuid IN (:...rbacDeviceGroups)',
      { rbacDeviceGroups: ['group-1', 'group-2'] },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'peer.deviceGroupGuid = :deviceGroupGuid',
      { deviceGroupGuid: 'group-1' },
    );
    expect(builder.getManyAndCount).toHaveBeenCalledTimes(1);
  });

  it('applies status, online, and operating-system filters before pagination', async () => {
    const builder = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const service = new DeviceGroupService(
      {} as never,
      {} as never,
      { createQueryBuilder: jest.fn().mockReturnValue(builder) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.getDevices(
      'actor',
      {
        current: 1,
        pageSize: 20,
        status: '0',
        is_online: '1',
        os: 'linux',
      },
      false,
      { global: true, deviceGroupGuids: new Set() },
    );

    expect(builder.andWhere).toHaveBeenCalledWith('peer.status = :status', {
      status: 0,
    });
    expect(builder.andWhere).toHaveBeenCalledWith(
      'peer.lastHeartbeat > :onlineAfter',
      { onlineAfter: expect.any(Date) },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('si.os LIKE :os'),
      { os: '%linux%' },
    );
    expect(builder.getManyAndCount).toHaveBeenCalledTimes(1);
  });
});

describe('DeviceGroupService scoped writes', () => {
  const scopedAuthorization = {
    peers: [{ uuid: 'peer-1', deviceGroupGuid: 'group-1' }],
    scope: {
      global: false,
      deviceGroupGuids: new Set(['group-1']),
    },
  };

  const createService = (affected: number) => {
    const manager = {
      update: jest.fn().mockResolvedValue({ affected }),
    };
    const dataSource = {
      transaction: jest.fn((callback: (value: typeof manager) => unknown) =>
        callback(manager),
      ),
    };
    const authorizationService = {
      assertDevicesAccess: jest.fn().mockResolvedValue(scopedAuthorization),
    };
    const service = new DeviceGroupService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      dataSource as never,
      authorizationService as never,
    );
    return { service, manager, authorizationService };
  };

  it('includes the authorized device groups in the atomic status update', async () => {
    const { service, manager } = createService(1);

    await expect(
      service.updateDeviceStatus(['peer-1'], DeviceStatus.DISABLED, 'actor'),
    ).resolves.toMatchObject({ succeeded: ['peer-1'], failed: [] });

    expect(manager.update).toHaveBeenCalledWith(
      Peer,
      expect.objectContaining({
        uuid: expect.anything(),
        deviceGroupGuid: expect.anything(),
      }),
      { status: 0 },
    );
  });

  it('rechecks authorization and rejects the whole batch after a concurrent move', async () => {
    const { service, authorizationService } = createService(0);
    authorizationService.assertDevicesAccess
      .mockResolvedValueOnce(scopedAuthorization)
      .mockRejectedValueOnce(
        new ForbiddenException('Batch request contains unauthorized devices'),
      );

    await expect(
      service.updateDeviceStatus(['peer-1'], DeviceStatus.DISABLED, 'actor'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(authorizationService.assertDevicesAccess).toHaveBeenCalledTimes(2);
  });
});
