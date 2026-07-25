import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { UserToken } from '../../user/entities/user-token.entity';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { AssignUserRolesDto } from '../dto/user-role.dto';

/**
 * 用户-角色服务
 *
 * 职责：
 * - 查询用户角色
 * - 整体替换用户角色（事务），变更后失效该用户会话
 */
@Injectable()
export class UserRoleService {
  private readonly logger = new Logger(UserRoleService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
    @InjectRepository(UserToken)
    private readonly userTokenRepository: Repository<UserToken>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 获取用户已绑定的角色 code 列表
   */
  async getUserRoles(userGuid: string): Promise<string[]> {
    await this.ensureUserExists(userGuid);
    const urs = await this.userRoleRepository.find({
      where: { userGuid },
      relations: { role: true },
    });
    return urs.map((ur) => ur.role.code);
  }

  /**
   * 整体替换用户角色
   * 事务内删除旧绑定并写入新绑定；变更后失效该用户会话以刷新权限。
   */
  async assignUserRoles(
    userGuid: string,
    dto: AssignUserRolesDto,
  ): Promise<void> {
    await this.ensureUserExists(userGuid);

    const codes = [...new Set(dto.role_codes)];
    let roles: Role[] = [];
    if (codes.length) {
      roles = await this.roleRepository.find({
        where: { code: In(codes) },
      });
      const found = new Set(roles.map((r) => r.code));
      const missing = codes.filter((c) => !found.has(c));
      if (missing.length) {
        throw new BadRequestException(`角色不存在: ${missing.join(', ')}`);
      }
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(UserRole, { userGuid });
      if (roles.length) {
        await manager.insert(
          UserRole,
          roles.map((r) => ({ userGuid, roleGuid: r.guid })),
        );
      }
    });

    // 失效该用户会话，使其重新登录获取最新权限
    await this.userTokenRepository.update(
      { userGuid, isRevoked: false },
      { isRevoked: true },
    );
    this.logger.log(`用户 ${userGuid} 角色已更新，已失效其会话`);
  }

  private async ensureUserExists(userGuid: string): Promise<void> {
    const exists = await this.userRepository.exist({
      where: { guid: userGuid },
    });
    if (!exists) {
      throw new NotFoundException('用户不存在');
    }
  }
}
