import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    strategy.modifiedAt = Date.now();

    await this.strategyRepository.save(strategy);

    return {
      guid: strategy.guid,
      name: strategy.name,
      note: strategy.note,
      config_options: dto.config_options || {},
      modified_at: strategy.modifiedAt,
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

    strategy.modifiedAt = Date.now();

    await this.strategyRepository.save(strategy);

    const configOptions: Record<string, string> = dto.config_options
      ? dto.config_options
      : (JSON.parse(strategy.configOptions || '{}') as Record<string, string>);

    return {
      guid: strategy.guid,
      name: strategy.name,
      note: strategy.note,
      config_options: configOptions,
      modified_at: strategy.modifiedAt,
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
        config_options: JSON.parse(s.configOptions || '{}') as Record<
          string,
          string
        >,
        modified_at: s.modifiedAt,
        created_at: s.createdAt,
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
      modified_at: strategy.modifiedAt,
      created_at: strategy.createdAt,
      updated_at: strategy.updatedAt,
    };
  }

  async assignStrategy(
    strategyGuid: string,
    targetType: string,
    targetGuid: string,
  ) {
    const strategy = await this.strategyRepository.findOne({
      where: { guid: strategyGuid },
    });
    if (!strategy) {
      throw new NotFoundException('策略不存在');
    }

    switch (targetType) {
      case 'device': {
        const peer = await this.peerRepository.findOne({
          where: { uuid: targetGuid },
        });
        if (!peer) {
          throw new NotFoundException('设备不存在');
        }
        await this.peerRepository.update(
          { uuid: targetGuid },
          { strategyGuid },
        );
        break;
      }
      case 'user': {
        const user = await this.userRepository.findOne({
          where: { guid: targetGuid },
        });
        if (!user) {
          throw new NotFoundException('用户不存在');
        }
        await this.userRepository.update(
          { guid: targetGuid },
          { strategyGuid },
        );
        break;
      }
      case 'device_group': {
        const group = await this.deviceGroupRepository.findOne({
          where: { guid: targetGuid },
        });
        if (!group) {
          throw new NotFoundException('设备组不存在');
        }
        await this.deviceGroupRepository.update(
          { guid: targetGuid },
          { strategyGuid },
        );
        break;
      }
      default:
        throw new BadRequestException(
          `不支持的目标类型: ${String(targetType)}`,
        );
    }

    return { message: '策略分配成功' };
  }

  async unassignStrategy(targetType: string, targetGuid: string) {
    switch (targetType) {
      case 'device': {
        const peer = await this.peerRepository.findOne({
          where: { uuid: targetGuid },
        });
        if (!peer) {
          throw new NotFoundException('设备不存在');
        }
        await this.peerRepository.update(
          { uuid: targetGuid },
          { strategyGuid: null },
        );
        break;
      }
      case 'user': {
        const user = await this.userRepository.findOne({
          where: { guid: targetGuid },
        });
        if (!user) {
          throw new NotFoundException('用户不存在');
        }
        await this.userRepository.update(
          { guid: targetGuid },
          { strategyGuid: null },
        );
        break;
      }
      case 'device_group': {
        const group = await this.deviceGroupRepository.findOne({
          where: { guid: targetGuid },
        });
        if (!group) {
          throw new NotFoundException('设备组不存在');
        }
        await this.deviceGroupRepository.update(
          { guid: targetGuid },
          { strategyGuid: null },
        );
        break;
      }
      default:
        throw new BadRequestException(
          `不支持的目标类型: ${String(targetType)}`,
        );
    }

    return { message: '策略取消分配成功' };
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
