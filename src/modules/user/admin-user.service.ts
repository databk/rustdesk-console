import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Strategy } from '../strategy/entities/strategy.entity';
import { AdminUserQueryDto } from './dto/admin-user.dto';

@Injectable()
export class AdminUserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Strategy)
    private strategyRepository: Repository<Strategy>,
  ) {}

  async getAdminUsers(
    query: AdminUserQueryDto,
  ): Promise<{ data: any[]; total: number }> {
    const { current, pageSize, status, name, email, is_admin, third_auth_type, strategy_name } = query;
    const skip = (current - 1) * pageSize;

    const queryBuilder = this.userRepository.createQueryBuilder('user');

    if (status !== undefined) {
      queryBuilder.andWhere('user.status = :status', { status });
    }

    if (name) {
      queryBuilder.andWhere('user.username LIKE :name', { name: `%${name}%` });
    }

    if (email) {
      queryBuilder.andWhere('user.email LIKE :email', { email: `%${email}%` });
    }

    if (is_admin !== undefined) {
      queryBuilder.andWhere('user.isAdmin = :isAdmin', { isAdmin: is_admin === 1 });
    }

    if (third_auth_type) {
      queryBuilder.andWhere('user.thirdAuthType = :thirdAuthType', {
        thirdAuthType: third_auth_type,
      });
    }

    if (strategy_name) {
      queryBuilder.andWhere(
        `EXISTS (
          SELECT 1 FROM strategies s
          WHERE s.guid = user.strategyGuid AND s.name LIKE :strategyName
        )`,
        { strategyName: `%${strategy_name}%` },
      );
    }

    const [users, total] = await queryBuilder
      .orderBy('user.createdAt', 'DESC')
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();

    // Batch load strategy names
    const strategyGuids = [
      ...new Set(
        users
          .map((u) => u.strategyGuid)
          .filter((g): g is string => g != null),
      ),
    ];
    const strategies =
      strategyGuids.length > 0
        ? await this.strategyRepository.find({
            where: strategyGuids.map((guid) => ({ guid })),
          })
        : [];
    const strategyMap = new Map(strategies.map((s) => [s.guid, s.name]));

    return {
      data: users.map((u) => ({
        guid: u.guid,
        name: u.username,
        email: u.email || '',
        note: u.note || '',
        status: u.status,
        is_admin: u.isAdmin,
        third_auth_type: u.thirdAuthType || '',
        strategy_guid: u.strategyGuid || '',
        strategy_name: u.strategyGuid ? strategyMap.get(u.strategyGuid) || '' : '',
        avatar: u.avatar || '',
        created_at: u.createdAt,
        updated_at: u.updatedAt,
      })),
      total,
    };
  }
}
