import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../user/entities/user.entity';

/** User query options, controlling which sensitive fields need an extra select */
export interface UserQueryOptions {
  /** Whether to select the password field; defaults to false */
  withPassword?: boolean;
  /** Whether to select the TFA secret field; defaults to false */
  withTfaSecret?: boolean;
  /** Whether to select the info field; defaults to true */
  withInfo?: boolean;
  /** Whether to select the thirdAuthType field; defaults to true */
  withThirdAuthType?: boolean;
  /** Whether to select the avatar field; defaults to true */
  withAvatar?: boolean;
}

/**
 * Auth user query helper
 * Encapsulates common user queries in the login flow (including sensitive field selects),
 * eliminating duplicated query building in AuthService / AuthTfaService / AuthEmailService / AuthPasskeyService
 */
@Injectable()
export class AuthUserHelper {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Find a user by GUID
   * Includes the info, thirdAuthType, and avatar fields by default
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
   * Find a user by username or email
   * Includes the info, thirdAuthType, and avatar fields by default
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
   * Add addSelect for sensitive fields based on the query options
   * info, thirdAuthType, and avatar are selected by default; password and tfaSecret are not
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
