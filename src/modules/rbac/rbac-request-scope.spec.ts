import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Peer } from '../../common/entities/peer.entity';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import { User, UserStatus } from '../user/entities/user.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRoleAssignment } from './entities/user-role-assignment.entity';
import { UserRoleAssignmentDeviceGroup } from './entities/user-role-assignment-device-group.entity';
import { RbacAuditService } from './services/rbac-audit.service';
import { RbacAuthorizationService } from './services/rbac-authorization.service';
import {
  cacheUserStatusSnapshot,
  createRbacRequestCache,
  rbacRequestStorage,
} from './rbac-request-scope';

jest.mock('uuid', () => {
  const cryptoModule =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { v4: cryptoModule.randomUUID };
});

type MockRepository = {
  findOne: jest.Mock;
  find: jest.Mock;
};

const repository = (): MockRepository => ({
  findOne: jest.fn(),
  find: jest.fn(),
});

describe('request-scoped RBAC cache', () => {
  let userRepository: MockRepository;
  let rolePermissionRepository: MockRepository;
  let assignmentRepository: MockRepository;
  let assignmentGroupRepository: MockRepository;
  let peerRepository: MockRepository;
  let deviceGroupRepository: MockRepository;
  let roleRepository: MockRepository;
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
    const auditService = {
      recordDenied: jest.fn().mockResolvedValue(undefined),
    };
    userRepository.findOne.mockResolvedValue(activeUser);
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'device_group' },
    ]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'devices.view' },
    ]);
    assignmentGroupRepository.find.mockResolvedValue([
      { assignmentGuid: 'assignment-1', deviceGroupGuid: 'group-1' },
    ]);
    roleRepository.find.mockResolvedValue([]);
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

  it('queries each authorization table once per request across repeated checks', async () => {
    await rbacRequestStorage.run(createRbacRequestCache(), async () => {
      await service.requirePermission('actor', 'devices.view');
      await service.getPermissionScope('actor', 'devices.view');
      await service.getCurrentUser('actor');
      await service.requirePermission('actor', 'devices.view');
    });

    expect(userRepository.findOne).toHaveBeenCalledTimes(1);
    expect(assignmentRepository.find).toHaveBeenCalledTimes(1);
    expect(rolePermissionRepository.find).toHaveBeenCalledTimes(1);
    expect(assignmentGroupRepository.find).toHaveBeenCalledTimes(1);
  });

  it('caches by permission code so different permissions reload only shared data', async () => {
    assignmentRepository.find.mockResolvedValue([
      { guid: 'assignment-1', roleGuid: 'role-1', scopeType: 'global' },
    ]);
    rolePermissionRepository.find.mockResolvedValue([
      { roleGuid: 'role-1', permissionCode: 'devices.view' },
      { roleGuid: 'role-1', permissionCode: 'strategies.assign' },
    ]);

    await rbacRequestStorage.run(createRbacRequestCache(), async () => {
      await service.requirePermission('actor', 'devices.view');
      await service.requirePermission('actor', 'strategies.assign');
    });

    expect(userRepository.findOne).toHaveBeenCalledTimes(1);
    expect(assignmentRepository.find).toHaveBeenCalledTimes(1);
    expect(rolePermissionRepository.find).toHaveBeenCalledTimes(1);
  });

  it('reuses the user snapshot published by JWT validation without querying', async () => {
    await rbacRequestStorage.run(createRbacRequestCache(), async () => {
      cacheUserStatusSnapshot({
        guid: 'actor',
        status: UserStatus.ACTIVE,
        isAdmin: true,
      });
      const user = await service.getCurrentUser('actor');
      expect(user.isAdmin).toBe(true);
      await service.requireSuperAdmin('actor');
    });

    expect(userRepository.findOne).not.toHaveBeenCalled();
  });

  it('isolates caches between requests', async () => {
    await rbacRequestStorage.run(createRbacRequestCache(), async () => {
      await service.getCurrentUser('actor');
    });
    await rbacRequestStorage.run(createRbacRequestCache(), async () => {
      await service.getCurrentUser('actor');
    });

    expect(userRepository.findOne).toHaveBeenCalledTimes(2);
  });

  it('keeps a consistent denial for users disabled during the request', async () => {
    userRepository.findOne.mockResolvedValue({
      ...activeUser,
      status: UserStatus.DISABLED,
    });

    await rbacRequestStorage.run(createRbacRequestCache(), async () => {
      await expect(service.getCurrentUser('actor')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // The snapshot promise resolves to the same row, so the second call
      // fails identically without a second database round trip.
      await expect(service.getCurrentUser('actor')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    expect(userRepository.findOne).toHaveBeenCalledTimes(1);
  });

  it('bypasses the cache when a transaction manager is provided', async () => {
    const managerUserRepository = repository();
    managerUserRepository.findOne.mockResolvedValue(activeUser);
    const manager = {
      getRepository: jest.fn(() => managerUserRepository),
    };

    await rbacRequestStorage.run(createRbacRequestCache(), async () => {
      await service.getCurrentUser('actor', manager as never);
      await service.getCurrentUser('actor', manager as never);
    });

    expect(managerUserRepository.findOne).toHaveBeenCalledTimes(2);
    expect(userRepository.findOne).not.toHaveBeenCalled();
  });
});
