import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as uuid from 'uuid';
import { Strategy } from './entities/strategy.entity';
import { Peer } from '../../common/entities/peer.entity';
import { User } from '../user/entities/user.entity';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import {
  CreateStrategyDto,
  UpdateStrategyDto,
  StrategyQueryDto,
} from './dto/strategy.dto';

@Injectable()
export class StrategyService {
  private readonly logger = new Logger(StrategyService.name);

  constructor(
    @InjectRepository(Strategy)
    private strategyRepository: Repository<Strategy>,
    @InjectRepository(Peer)
    private peerRepository: Repository<Peer>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(DeviceGroup)
    private deviceGroupRepository: Repository<DeviceGroup>,
  ) {}

  async createStrategy(dto: CreateStrategyDto) {
    const existing = await this.strategyRepository.findOne({
      where: { name: dto.name },
    });
    if (existing) {
      throw new BadRequestException('策略名称已存在');
    }

    const strategy = new Strategy();
    strategy.guid = uuid.v4();
    strategy.name = dto.name;
    strategy.note = dto.note || '';
    strategy.configOptions = dto.config_options
      ? JSON.stringify(dto.config_options)
      : '';

    await this.strategyRepository.save(strategy);

    return {
      guid: strategy.guid,
      name: strategy.name,
      note: strategy.note,
      config_options: dto.config_options || {},
      updated_at: strategy.updatedAt,
    };
  }

  async updateStrategy(guid: string, dto: UpdateStrategyDto) {
    const strategy = await this.strategyRepository.findOne({
      where: { guid },
    });
    if (!strategy) {
      throw new NotFoundException('策略不存在');
    }

    if (dto.name !== undefined) {
      const existing = await this.strategyRepository.findOne({
        where: { name: dto.name },
      });
      if (existing && existing.guid !== guid) {
        throw new BadRequestException('策略名称已存在');
      }
      strategy.name = dto.name;
    }

    if (dto.note !== undefined) {
      strategy.note = dto.note;
    }

    if (dto.config_options !== undefined) {
      strategy.configOptions = JSON.stringify(dto.config_options);
    }

    await this.strategyRepository.save(strategy);

    const configOptions: Record<string, string> = dto.config_options
      ? dto.config_options
      : (JSON.parse(strategy.configOptions || '{}') as Record<string, string>);

    return {
      guid: strategy.guid,
      name: strategy.name,
      note: strategy.note,
      config_options: configOptions,
      updated_at: strategy.updatedAt,
    };
  }

  async deleteStrategy(guid: string) {
    const strategy = await this.strategyRepository.findOne({
      where: { guid },
    });
    if (!strategy) {
      throw new NotFoundException('策略不存在');
    }

    await this.strategyRepository.remove(strategy);
  }

  async getStrategies(query: StrategyQueryDto) {
    const { current, pageSize, name } = query;
    const skip = (current - 1) * pageSize;

    let queryBuilder = this.strategyRepository
      .createQueryBuilder('strategy')
      .orderBy('strategy.name', 'ASC')
      .skip(skip)
      .take(pageSize);

    if (name) {
      queryBuilder = queryBuilder.where('strategy.name LIKE :name', {
        name: `%${name}%`,
      });
    }

    const [strategies, total] = await queryBuilder.getManyAndCount();

    return {
      data: strategies.map((s) => ({
        guid: s.guid,
        name: s.name,
        note: s.note || '',
        updated_at: s.updatedAt,
      })),
      total,
    };
  }

  async getStrategy(guid: string) {
    const strategy = await this.strategyRepository.findOne({
      where: { guid },
    });
    if (!strategy) {
      throw new NotFoundException('策略不存在');
    }

    return {
      guid: strategy.guid,
      name: strategy.name,
      note: strategy.note || '',
      config_options: JSON.parse(strategy.configOptions || '{}') as Record<
        string,
        string
      >,
      updated_at: strategy.updatedAt,
    };
  }

  async assignStrategy(
    strategyGuid: string,
    targetType: string,
    targetGuids: string[],
  ) {
    const strategy = await this.strategyRepository.findOne({
      where: { guid: strategyGuid },
    });
    if (!strategy) {
      throw new NotFoundException('策略不存在');
    }

    const success: string[] = [];
    const errors: { target_guid: string; reason: string }[] = [];

    switch (targetType) {
      case 'device': {
        const peers = await this.peerRepository.find({
          where: { uuid: In(targetGuids) },
        });
        const foundUuids = new Set(peers.map((p) => p.uuid));
        for (const targetGuid of targetGuids) {
          if (!foundUuids.has(targetGuid)) {
            errors.push({ target_guid: targetGuid, reason: '设备不存在' });
          }
        }
        if (peers.length > 0) {
          await this.peerRepository.update(
            { uuid: In(peers.map((p) => p.uuid)) },
            { strategyGuid },
          );
          success.push(...peers.map((p) => p.uuid));
        }
        break;
      }
      case 'user': {
        const users = await this.userRepository.find({
          where: { guid: In(targetGuids) },
        });
        const foundGuids = new Set(users.map((u) => u.guid));
        for (const targetGuid of targetGuids) {
          if (!foundGuids.has(targetGuid)) {
            errors.push({ target_guid: targetGuid, reason: '用户不存在' });
          }
        }
        if (users.length > 0) {
          await this.userRepository.update(
            { guid: In(users.map((u) => u.guid)) },
            { strategyGuid },
          );
          success.push(...users.map((u) => u.guid));
        }
        break;
      }
      case 'device_group': {
        const groups = await this.deviceGroupRepository.find({
          where: { guid: In(targetGuids) },
        });
        const foundGuids = new Set(groups.map((g) => g.guid));
        for (const targetGuid of targetGuids) {
          if (!foundGuids.has(targetGuid)) {
            errors.push({ target_guid: targetGuid, reason: '设备组不存在' });
          }
        }
        if (groups.length > 0) {
          await this.deviceGroupRepository.update(
            { guid: In(groups.map((g) => g.guid)) },
            { strategyGuid },
          );
          success.push(...groups.map((g) => g.guid));
        }
        break;
      }
      default:
        throw new BadRequestException(
          `不支持的目标类型: ${String(targetType)}`,
        );
    }

    return { success, errors };
  }

  async unassignStrategy(targetType: string, targetGuids: string[]) {
    const success: string[] = [];
    const errors: { target_guid: string; reason: string }[] = [];

    switch (targetType) {
      case 'device': {
        const peers = await this.peerRepository.find({
          where: { uuid: In(targetGuids) },
        });
        const foundUuids = new Set(peers.map((p) => p.uuid));
        for (const targetGuid of targetGuids) {
          if (!foundUuids.has(targetGuid)) {
            errors.push({ target_guid: targetGuid, reason: '设备不存在' });
          }
        }
        if (peers.length > 0) {
          await this.peerRepository.update(
            { uuid: In(peers.map((p) => p.uuid)) },
            { strategyGuid: null },
          );
          success.push(...peers.map((p) => p.uuid));
        }
        break;
      }
      case 'user': {
        const users = await this.userRepository.find({
          where: { guid: In(targetGuids) },
        });
        const foundGuids = new Set(users.map((u) => u.guid));
        for (const targetGuid of targetGuids) {
          if (!foundGuids.has(targetGuid)) {
            errors.push({ target_guid: targetGuid, reason: '用户不存在' });
          }
        }
        if (users.length > 0) {
          await this.userRepository.update(
            { guid: In(users.map((u) => u.guid)) },
            { strategyGuid: null },
          );
          success.push(...users.map((u) => u.guid));
        }
        break;
      }
      case 'device_group': {
        const groups = await this.deviceGroupRepository.find({
          where: { guid: In(targetGuids) },
        });
        const foundGuids = new Set(groups.map((g) => g.guid));
        for (const targetGuid of targetGuids) {
          if (!foundGuids.has(targetGuid)) {
            errors.push({ target_guid: targetGuid, reason: '设备组不存在' });
          }
        }
        if (groups.length > 0) {
          await this.deviceGroupRepository.update(
            { guid: In(groups.map((g) => g.guid)) },
            { strategyGuid: null },
          );
          success.push(...groups.map((g) => g.guid));
        }
        break;
      }
      default:
        throw new BadRequestException(
          `不支持的目标类型: ${String(targetType)}`,
        );
    }

    return { success, errors };
  }

  async findStrategyForDevice(deviceUuid: string): Promise<Strategy | null> {
    const peer = await this.peerRepository.findOne({
      where: { uuid: deviceUuid },
    });
    if (!peer) {
      return null;
    }

    if (peer.strategyGuid) {
      const strategy = await this.strategyRepository.findOne({
        where: { guid: peer.strategyGuid },
      });
      if (strategy) {
        return strategy;
      }
    }

    if (peer.userGuid) {
      const user = await this.userRepository.findOne({
        where: { guid: peer.userGuid },
      });
      if (user?.strategyGuid) {
        const strategy = await this.strategyRepository.findOne({
          where: { guid: user.strategyGuid },
        });
        if (strategy) {
          return strategy;
        }
      }
    }

    if (peer.deviceGroupGuid) {
      const group = await this.deviceGroupRepository.findOne({
        where: { guid: peer.deviceGroupGuid },
      });
      if (group?.strategyGuid) {
        const strategy = await this.strategyRepository.findOne({
          where: { guid: group.strategyGuid },
        });
        if (strategy) {
          return strategy;
        }
      }
    }

    return null;
  }
}
