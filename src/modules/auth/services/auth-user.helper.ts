import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../user/entities/user.entity';

/** 用户查询选项，控制需要额外 select 的敏感字段 */
export interface UserQueryOptions {
  /** 是否查询密码字段，默认 false */
  withPassword?: boolean;
  /** 是否查询 TFA 密钥字段，默认 false */
  withTfaSecret?: boolean;
  /** 是否查询 info 字段，默认 true */
  withInfo?: boolean;
  /** 是否查询 thirdAuthType 字段，默认 true */
  withThirdAuthType?: boolean;
  /** 是否查询 avatar 字段，默认 true */
  withAvatar?: boolean;
}

/**
 * 认证用户查询助手
 * 统一封装登录流程中常见的用户查询（含敏感字段 select），
 * 消除 AuthService / AuthTfaService / AuthEmailService / AuthPasskeyService 中的重复查询构建
 */
@Injectable()
export class AuthUserHelper {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * 通过 GUID 查询用户
   * 默认包含 info、thirdAuthType、avatar 字段
   */
  async findByGuid(
    guid: string,
    options: UserQueryOptions = {},
  ): Promise<User | null> {
    const queryBuilder = this.userRepository
      .createQueryBuilder('user')
      .where('user.guid = :guid', { guid });

    this.applySelects(queryBuilder, options);

    return queryBuilder.getOne();
  }

  /**
   * 通过用户名或邮箱查询用户
   * 默认包含 info、thirdAuthType、avatar 字段
   */
  async findByUsernameOrEmail(
    username: string,
    options: UserQueryOptions = {},
  ): Promise<User | null> {
    const queryBuilder = this.userRepository
      .createQueryBuilder('user')
      .where('user.username = :username OR user.email = :email', {
        username,
        email: username,
      });

    this.applySelects(queryBuilder, options);

    return queryBuilder.getOne();
  }

  /**
   * 根据查询选项添加敏感字段的 addSelect
   * info、thirdAuthType、avatar 默认查询；password、tfaSecret 默认不查询
   */
  private applySelects(
    queryBuilder: ReturnType<Repository<User>['createQueryBuilder']>,
    options: UserQueryOptions,
  ): void {
    const {
      withPassword = false,
      withTfaSecret = false,
      withInfo = true,
      withThirdAuthType = true,
      withAvatar = true,
    } = options;

    if (withPassword) {
      queryBuilder.addSelect('user.password');
    }
    if (withTfaSecret) {
      queryBuilder.addSelect('user.tfaSecret');
    }
    if (withInfo) {
      queryBuilder.addSelect('user.info');
    }
    if (withThirdAuthType) {
      queryBuilder.addSelect('user.thirdAuthType');
    }
    if (withAvatar) {
      queryBuilder.addSelect('user.avatar');
    }
  }
}
