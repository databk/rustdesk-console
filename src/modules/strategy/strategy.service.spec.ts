import 'reflect-metadata';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Repository } from 'typeorm';
import { Peer } from '../../common/entities/peer.entity';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import { REQUIRE_PERMISSION_KEY } from '../rbac/decorators/require-permission.decorator';
import { RbacAuthorizationService } from '../rbac/services/rbac-authorization.service';
import { User } from '../user/entities/user.entity';
import {
  StrategyQueryDto,
  StrategyTargetCandidateQueryDto,
} from './dto/strategy.dto';
import { Strategy } from './entities/strategy.entity';
import { StrategyController } from './strategy.controller';
import { StrategyService } from './strategy.service';

jest.mock('uuid', () => {
  const cryptoModule =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { v4: cryptoModule.randomUUID };
});

type MockRepository = {
  findOne: jest.Mock;
  find: jest.Mock;
  findAndCount: jest.Mock;
  update: jest.Mock;
  createQueryBuilder: jest.Mock;
  manager: { transaction: jest.Mock };
};

const repository = (): MockRepository => ({
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
  findAndCount: jest.fn().mockResolvedValue([[], 0]),
  update: jest.fn().mockResolvedValue(undefined),
  createQueryBuilder: jest.fn(),
  manager: { transaction: jest.fn() },
});

describe('Strategy candidate and target contracts', () => {
  let strategyRepository: MockRepository;
  let peerRepository: MockRepository;
  let userRepository: MockRepository;
  let deviceGroupRepository: MockRepository;
  let authorizationService: {
    assertStrategyTargets: jest.Mock;
    getCurrentUser: jest.Mock;
    requirePermission: jest.Mock;
    getEffectiveProtectionMap: jest.Mock;
  };
  let transactionManager: { update: jest.Mock; getRepository: jest.Mock };
  let service: StrategyService;

  beforeEach(() => {
    strategyRepository = repository();
    peerRepository = repository();
    userRepository = repository();
    deviceGroupRepository = repository();
    transactionManager = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      getRepository: jest.fn((entity: unknown) =>
        entity === Peer
          ? peerRepository
          : entity === User
            ? userRepository
            : entity === DeviceGroup
              ? deviceGroupRepository
              : strategyRepository,
      ),
    };
    peerRepository.manager.transaction.mockImplementation(
      (callback: (manager: typeof transactionManager) => unknown) =>
        callback(transactionManager),
    );
    authorizationService = {
      assertStrategyTargets: jest.fn().mockResolvedValue({
        global: true,
        deviceGroupGuids: new Set<string>(),
      }),
      getCurrentUser: jest.fn().mockResolvedValue({ isAdmin: false }),
      requirePermission: jest.fn().mockResolvedValue({
        global: true,
        deviceGroupGuids: new Set<string>(),
      }),
      getEffectiveProtectionMap: jest.fn().mockResolvedValue(new Map()),
    };
    service = new StrategyService(
      strategyRepository as unknown as Repository<Strategy>,
      peerRepository as unknown as Repository<Peer>,
      userRepository as unknown as Repository<User>,
      deviceGroupRepository as unknown as Repository<DeviceGroup>,
      peerRepository.manager as unknown as import('typeorm').DataSource,
      authorizationService as unknown as RbacAuthorizationService,
    );
  });

  it('returns only guid, name, and note from the candidate endpoint query', async () => {
    const queryBuilder = {
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([
        [
          {
            guid: 'strategy-1',
            name: 'Approved strategy',
            note: 'Summary',
            configOptions: JSON.stringify({ secret: 'sentinel-secret' }),
            updatedAt: new Date('2026-01-01T00:00:00Z'),
          },
        ],
        1,
      ]),
    };
    strategyRepository.createQueryBuilder.mockReturnValue(queryBuilder);

    const result = await service.getStrategyCandidates({
      current: 2,
      pageSize: 10,
      name: 'Approved',
    });

    expect(result).toEqual({
      data: [
        { guid: 'strategy-1', name: 'Approved strategy', note: 'Summary' },
      ],
      total: 1,
    });
    expect(JSON.stringify(result)).not.toContain('sentinel-secret');
    expect(queryBuilder.skip).toHaveBeenCalledWith(10);
    expect(queryBuilder.take).toHaveBeenCalledWith(10);
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'strategy.name LIKE :name',
      { name: '%Approved%' },
    );
  });

  it('requires strategies.assign and rejects an authenticated user without it', () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        StrategyController.prototype.getStrategyCandidates,
      ),
    ).toEqual(['strategies.assign']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        StrategyController.prototype.getStrategyTargetCandidates,
      ),
    ).toEqual(['strategies.assign']);
  });

  it('returns only scoped device identifiers from target candidates', async () => {
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([
        [
          {
            uuid: 'device-1',
            id: '123456789',
            status: 1,
            note: 'not exposed',
          },
        ],
        1,
      ]),
    };
    peerRepository.createQueryBuilder.mockReturnValue(queryBuilder);
    authorizationService.requirePermission.mockResolvedValue({
      global: false,
      deviceGroupGuids: new Set(['group-1']),
    });

    await expect(
      service.getStrategyTargetCandidates(
        { target_type: 'device', current: 1, pageSize: 20 },
        'actor',
      ),
    ).resolves.toEqual({
      data: [{ uuid: 'device-1', id: '123456789' }],
      total: 1,
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'peer.deviceGroupGuid IN (:...deviceGroupGuids)',
      { deviceGroupGuids: ['group-1'] },
    );
  });

  it('returns no device candidates when the assignment scope is empty', async () => {
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    peerRepository.createQueryBuilder.mockReturnValue(queryBuilder);
    authorizationService.requirePermission.mockResolvedValue({
      global: false,
      deviceGroupGuids: new Set<string>(),
    });

    await expect(
      service.getStrategyTargetCandidates(
        { target_type: 'device', current: 1, pageSize: 20 },
        'actor',
      ),
    ).resolves.toEqual({ data: [], total: 0 });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('1 = 0');
  });

  it('requires global assignment scope before loading user candidates', async () => {
    authorizationService.assertStrategyTargets.mockRejectedValue(
      new ForbiddenException(
        'Assigning strategies by user requires global permission',
      ),
    );

    await expect(
      service.getStrategyTargetCandidates(
        { target_type: 'user', current: 1, pageSize: 20 },
        'actor',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(userRepository.findAndCount).not.toHaveBeenCalled();
  });

  it('uses the existing pagination validation for candidate requests', async () => {
    const invalid = plainToInstance(StrategyQueryDto, {
      current: 0,
      pageSize: 20,
      name: 'candidate',
      config_options: { secret: true },
    });

    expect(
      await validate(invalid, {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).not.toHaveLength(0);
  });

  it('caps target candidate pages at 200 records', async () => {
    const invalid = plainToInstance(StrategyTargetCandidateQueryDto, {
      target_type: 'device',
      current: 1,
      pageSize: 201,
    });

    expect(await validate(invalid)).not.toHaveLength(0);
  });

  it('reports missing devices through the established partial batch response', async () => {
    strategyRepository.findOne.mockResolvedValue({ guid: 'strategy-1' });
    peerRepository.find.mockResolvedValue([{ uuid: 'device-1' }]);

    await expect(
      service.assignStrategy(
        'strategy-1',
        'device',
        ['device-1', 'missing-device'],
        'actor',
      ),
    ).resolves.toEqual({
      success: ['device-1'],
      errors: [{ target_guid: 'missing-device', reason: 'Device not found' }],
    });
    expect(transactionManager.update).toHaveBeenCalledTimes(1);
  });

  it('does not query or mutate targets after an out-of-scope denial', async () => {
    authorizationService.assertStrategyTargets.mockRejectedValue(
      new ForbiddenException(
        'Target device is not in an authorized device group',
      ),
    );

    await expect(
      service.assignStrategy(
        'strategy-1',
        'device',
        ['authorized-device', 'out-of-scope-device'],
        'actor',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(strategyRepository.findOne).not.toHaveBeenCalled();
    expect(peerRepository.find).not.toHaveBeenCalled();
    expect(peerRepository.manager.transaction).toHaveBeenCalledTimes(1);
  });

  it('keeps a missing strategy as a 404 after target authorization', async () => {
    strategyRepository.findOne.mockResolvedValue(null);

    await expect(
      service.assignStrategy(
        'missing-strategy',
        'device',
        ['device-1'],
        'actor',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(peerRepository.manager.transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a scoped assignment if the device leaves its authorized group before the write', async () => {
    strategyRepository.findOne.mockResolvedValue({ guid: 'strategy-1' });
    peerRepository.find.mockResolvedValue([{ uuid: 'device-1' }]);
    authorizationService.assertStrategyTargets
      .mockResolvedValueOnce({
        global: false,
        deviceGroupGuids: new Set(['group-1']),
      })
      .mockRejectedValueOnce(
        new ForbiddenException(
          'Target device is not in an authorized device group',
        ),
      );
    transactionManager.update.mockResolvedValue({ affected: 0 });

    await expect(
      service.assignStrategy('strategy-1', 'device', ['device-1'], 'actor'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(authorizationService.assertStrategyTargets).toHaveBeenCalledTimes(2);
  });

  it('fails closed when a user assignment updates fewer rows than read', async () => {
    strategyRepository.findOne.mockResolvedValue({ guid: 'strategy-1' });
    userRepository.find.mockResolvedValue([
      { guid: 'user-1', strategyGuid: null },
      { guid: 'user-2', strategyGuid: null },
    ]);
    userRepository.update.mockResolvedValue({ affected: 1 });

    await expect(
      service.assignStrategy(
        'strategy-1',
        'user',
        ['user-1', 'user-2'],
        'actor',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(userRepository.update).toHaveBeenCalledTimes(1);
    expect(transactionManager.update).not.toHaveBeenCalled();
  });

  it('reports missing users through the established partial batch response', async () => {
    strategyRepository.findOne.mockResolvedValue({ guid: 'strategy-1' });
    userRepository.find.mockResolvedValue([
      { guid: 'user-1', strategyGuid: null },
    ]);
    userRepository.update.mockResolvedValue({ affected: 1 });

    await expect(
      service.assignStrategy(
        'strategy-1',
        'user',
        ['user-1', 'missing-user'],
        'actor',
      ),
    ).resolves.toEqual({
      success: ['user-1'],
      errors: [{ target_guid: 'missing-user', reason: 'User does not exist' }],
    });
    expect(authorizationService.assertStrategyTargets).toHaveBeenCalledWith(
      'actor',
      'user',
      ['user-1'],
      transactionManager,
    );
  });

  it('fails closed when a user unassignment updates fewer rows than read', async () => {
    strategyRepository.findOne.mockResolvedValue({ guid: 'strategy-1' });
    userRepository.find.mockResolvedValue([
      { guid: 'user-1', strategyGuid: 'strategy-1' },
      { guid: 'user-2', strategyGuid: 'strategy-1' },
    ]);
    userRepository.update.mockResolvedValue({ affected: 1 });

    await expect(
      service.unassignStrategy(
        'strategy-1',
        'user',
        ['user-1', 'user-2'],
        'actor',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(userRepository.update).toHaveBeenCalledTimes(1);
    expect(transactionManager.update).not.toHaveBeenCalled();
  });

  it('updates only requested authorized groups when assigning', async () => {
    strategyRepository.findOne.mockResolvedValue({ guid: 'strategy-1' });
    authorizationService.assertStrategyTargets.mockResolvedValue({
      global: false,
      deviceGroupGuids: new Set(['group-a', 'group-b']),
    });
    deviceGroupRepository.find.mockResolvedValue([
      { guid: 'group-a', strategyGuid: null },
    ]);

    await expect(
      service.assignStrategy(
        'strategy-1',
        'device_group',
        ['group-a'],
        'actor',
      ),
    ).resolves.toEqual({ success: ['group-a'], errors: [] });
    expect(transactionManager.update).toHaveBeenCalledWith(
      DeviceGroup,
      { guid: expect.anything() },
      { strategyGuid: 'strategy-1' },
    );
    const criteria = transactionManager.update.mock.calls[0][1];
    expect(criteria).not.toHaveProperty('strategyGuid');
    expect((criteria.guid as { _value: string[] })._value).toEqual(['group-a']);
  });

  it('updates only requested authorized groups when unassigning', async () => {
    strategyRepository.findOne.mockResolvedValue({ guid: 'strategy-1' });
    authorizationService.assertStrategyTargets.mockResolvedValue({
      global: false,
      deviceGroupGuids: new Set(['group-a', 'group-b']),
    });
    deviceGroupRepository.find.mockResolvedValue([
      { guid: 'group-a', strategyGuid: 'strategy-1' },
    ]);

    await expect(
      service.unassignStrategy(
        'strategy-1',
        'device_group',
        ['group-a'],
        'actor',
      ),
    ).resolves.toEqual({ success: ['group-a'], errors: [] });
    expect(transactionManager.update).toHaveBeenCalledWith(
      DeviceGroup,
      { guid: expect.anything(), strategyGuid: 'strategy-1' },
      { strategyGuid: null },
    );
    const criteria = transactionManager.update.mock.calls[0][1];
    expect(criteria).not.toHaveProperty('deviceGroupGuids');
    expect((criteria.guid as { _value: string[] })._value).toEqual(['group-a']);
  });

  it('authorizes assignment reads before looking up the strategy', async () => {
    authorizationService.requirePermission.mockRejectedValue(
      new ForbiddenException('Access denied'),
    );

    await expect(
      service.getStrategyAssignments(
        'strategy-1',
        { target_type: 'device', current: 1, pageSize: 20 },
        'actor',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(strategyRepository.findOne).not.toHaveBeenCalled();
  });

  it('hides administrator assignment rows from delegated assigners', async () => {
    strategyRepository.findOne.mockResolvedValue({ guid: 'strategy-1' });
    userRepository.findAndCount.mockResolvedValue([
      [
        {
          guid: 'user-1',
          username: 'username',
          displayName: 'Display name',
          email: 'secret@example.com',
          status: 1,
          isAdmin: false,
        },
      ],
      1,
    ]);

    const result = await service.getStrategyAssignments(
      'strategy-1',
      { target_type: 'user', current: 1, pageSize: 20 },
      'actor',
    );

    expect(userRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { strategyGuid: 'strategy-1', isAdmin: false },
      }),
    );
    expect(result).toEqual({
      data: [{ guid: 'user-1', name: 'Display name', is_protected: false }],
      total: 1,
    });
    expect(JSON.stringify(result)).not.toContain('secret@example.com');
  });

  it('keeps administrator assignment rows visible to super administrators', async () => {
    strategyRepository.findOne.mockResolvedValue({ guid: 'strategy-1' });
    authorizationService.getCurrentUser.mockResolvedValue({ isAdmin: true });

    await service.getStrategyAssignments(
      'strategy-1',
      { target_type: 'user', current: 1, pageSize: 20 },
      'actor',
    );

    expect(userRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { strategyGuid: 'strategy-1' } }),
    );
  });
});
