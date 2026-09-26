import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { User, UserStatus, UserInfo } from './entities/user.entity';
import { UserToken } from './entities/user-token.entity';
import { Invitation } from './entities/invitation.entity';
import { DeviceGroupUserPermission } from '../device-group/entities/device-group-user-permission.entity';
import { UserUserPermission } from '../device-group/entities/user-user-permission.entity';
import {
  CreateUserDto,
  InviteUserDto,
  AcceptInvitationDto,
  UpdateUserDto,
  UpdateUserSecurityDto,
  UpdateCurrentUserDto,
  BatchStatusDto,
  BatchSecurityDto,
  ChangePasswordDto,
} from './dto/user.dto';
import { UserGroupService } from '../user-group/user-group.service';
import { RbacAuthorizationService } from '../rbac/services/rbac-authorization.service';
import { LoginSession } from '../auth/entities/login-session.entity';
import { EmailService } from '../email/email.service';
import { GeneralSettingsService } from '../settings/services/general-settings.service';
import { getAvatarDir } from '../../common/utils/data-dir.util';

const AVATAR_DIR = getAvatarDir();
const AVATAR_SIZE = 256;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 2 * 1024 * 1024;

const INVITATION_EXPIRY_DAYS = 7;
const INVITATION_TOKEN_BYTES = 32;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserToken)
    private userTokenRepository: Repository<UserToken>,
    @InjectRepository(Invitation)
    private invitationRepository: Repository<Invitation>,
    @InjectRepository(DeviceGroupUserPermission)
    private deviceGroupUserPermissionRepository: Repository<DeviceGroupUserPermission>,
    @InjectRepository(UserUserPermission)
    private userUserPermissionRepository: Repository<UserUserPermission>,
    private readonly userGroupService: UserGroupService,
    private readonly emailService: EmailService,
    private readonly generalSettingsService: GeneralSettingsService,
    private readonly dataSource: DataSource,
    private readonly authorizationService: RbacAuthorizationService,
    @InjectRepository(LoginSession)
    private readonly loginSessionRepository: Repository<LoginSession>,
  ) {}

  async getAccessibleUsers(
    userGuid: string,
    query: {
      current: number;
      pageSize: number;
      status?: string;
      name?: string;
      group_name?: string;
    },
    isAdmin: boolean = false,
  ): Promise<{ data: any[]; total: number }> {
    const { current, pageSize, status, name, group_name } = query;
    const skip = (current - 1) * pageSize;

    if (isAdmin) {
      const queryBuilder = this.userRepository
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.userGroup', 'userGroup')
        .where('user.status = :status', {
          status: parseInt(status || '1') || UserStatus.ACTIVE,
        });

      if (name) {
        queryBuilder.andWhere(
          '(user.username LIKE :name OR user.displayName LIKE :name)',
          { name: `%${name}%` },
        );
      }

      if (group_name) {
        queryBuilder.andWhere(
          `EXISTS (
            SELECT 1 FROM device_group_user_permissions udgp
            INNER JOIN device_groups dg ON udgp.deviceGroupGuid = dg.guid
            WHERE udgp.userGuid = user.guid AND dg.name LIKE :groupName
          )`,
          { groupName: `%${group_name}%` },
        );
      }

      const [users, total] = await queryBuilder
        .orderBy('user.username', 'ASC')
        .skip(skip)
        .take(pageSize)
        .getManyAndCount();

      const protection =
        await this.authorizationService.getEffectiveProtectionMap(
          users.map((user) => user.guid),
        );
      return {
        data: users.map((user) =>
          this.buildUserResponse(user, protection.get(user.guid) === true),
        ),
        total,
      };
    }

    const queryBuilder = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userGroup', 'userGroup')
      .where('user.status = :status', {
        status: parseInt(status || '1') || UserStatus.ACTIVE,
      })
      .andWhere(
        `(user.guid = :userGuid
          OR EXISTS (
            SELECT 1 FROM user_user_permissions uup
            WHERE uup.userGuid = :userGuid AND uup.targetUserGuid = user.guid
          )
          OR EXISTS (
            SELECT 1 FROM peers p
            INNER JOIN device_group_user_permissions udgp ON p.deviceGroupGuid = udgp.deviceGroupGuid
            WHERE udgp.userGuid = :userGuid AND p.userGuid = user.guid
          )
        )`,
        { userGuid },
      );

    if (name) {
      queryBuilder.andWhere(
        '(user.username LIKE :name OR user.displayName LIKE :name)',
        { name: `%${name}%` },
      );
    }

    if (group_name) {
      queryBuilder.andWhere(
        `EXISTS (
          SELECT 1 FROM device_group_user_permissions udgp
          INNER JOIN device_groups dg ON udgp.deviceGroupGuid = dg.guid
          WHERE udgp.userGuid = user.guid AND dg.name LIKE :groupName
        )`,
        { groupName: `%${group_name}%` },
      );
    }

    const [users, total] = await queryBuilder
      .orderBy('user.username', 'ASC')
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();

    const protection =
      await this.authorizationService.getEffectiveProtectionMap(
        users.map((user) => user.guid),
      );
    return {
      data: users.map((user) =>
        this.buildUserResponse(user, protection.get(user.guid) === true),
      ),
      total,
    };
  }

  async createUser(dto: CreateUserDto) {
    const { name, password, email, note, display_name } = dto;
    const userGroupGuid = await this.userGroupService.resolveUserGroupGuid(
      dto.user_group_guid,
    );

    const existingUser = await this.userRepository.findOne({
      where: { username: name },
    });
    if (existingUser) {
      throw new BadRequestException('Username already exists');
    }

    if (email) {
      const existingEmail = await this.userRepository.findOne({
        where: { email },
      });
      if (existingEmail) {
        throw new BadRequestException('Email already exists');
      }
    }

    const user = new User();
    user.guid = uuidv4();
    user.username = name;
    user.displayName = display_name || null;
    user.email = email || null;
    user.password = await bcrypt.hash(password, 10);
    user.note = note || '';
    user.status = UserStatus.ACTIVE;
    user.isAdmin = false;
    user.userGroupGuid = userGroupGuid;

    await this.userRepository.save(user);

    return { message: 'User created successfully' };
  }

  async inviteUser(dto: InviteUserDto) {
    const { email, name, note, display_name } = dto;
    const userGroupGuid = await this.userGroupService.resolveUserGroupGuid(
      dto.user_group_guid,
    );

    const existingUser = await this.userRepository.findOne({
      where: { email },
    });
    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    const existingUsername = await this.userRepository.findOne({
      where: { username: name },
    });
    if (existingUsername) {
      throw new BadRequestException('Username already exists');
    }

    // Create user (UNVERIFIED status, empty password)
    const user = new User();
    user.guid = uuidv4();
    user.username = name;
    user.displayName = display_name || null;
    user.email = email;
    user.password = '';
    user.note = note || '';
    user.status = UserStatus.UNVERIFIED;
    user.isAdmin = false;
    user.userGroupGuid = userGroupGuid;

    await this.userRepository.save(user);

    // Generate invitation token
    const token = crypto.randomBytes(INVITATION_TOKEN_BYTES).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

    // Save invitation record
    const invitation = new Invitation();
    invitation.guid = uuidv4();
    invitation.token = token;
    invitation.email = email;
    invitation.name = name;
    invitation.displayName = display_name || null;
    invitation.userGroupGuid = userGroupGuid;
    invitation.note = note || null;
    invitation.userGuid = user.guid;
    invitation.expiresAt = expiresAt;
    invitation.usedAt = null;

    await this.invitationRepository.save(invitation);

    // Send invitation email
    const { effectiveFrontendUrl } =
      await this.generalSettingsService.getSiteSettings();
    const consoleUrl = effectiveFrontendUrl;
    const inviteUrl = `${consoleUrl}/#/invite?token=${token}`;
    const emailSent = await this.emailService.sendInvitation(
      email,
      inviteUrl,
      `${INVITATION_EXPIRY_DAYS} days`,
    );

    if (!emailSent) {
      this.logger.warn(
        `Failed to send invitation email, but the user was created: ${email}. Invitation token: ${token}`,
      );
    }

    return {
      message: emailSent
        ? 'Invitation sent successfully'
        : 'User created, but sending the invitation email failed; please check the SMTP configuration',
      token: emailSent ? undefined : token,
    };
  }

  /**
   * Verify invitation token
   * Returns invitation info for the frontend to display the invitation page
   */
  async verifyInvitation(token: string) {
    const invitation = await this.invitationRepository.findOne({
      where: { token },
    });

    if (!invitation) {
      throw new BadRequestException('Invalid invitation token');
    }

    if (invitation.usedAt) {
      throw new BadRequestException('Invitation has already been used');
    }

    if (new Date() > invitation.expiresAt) {
      throw new BadRequestException('Invitation has expired');
    }

    return {
      name: invitation.name,
      display_name: invitation.displayName || '',
      email: invitation.email,
    };
  }

  /**
   * Accept invitation
   * Verifies the token, sets the password, and activates the user
   */
  async acceptInvitation(dto: AcceptInvitationDto) {
    const invitation = await this.invitationRepository.findOne({
      where: { token: dto.token },
    });

    if (!invitation) {
      throw new BadRequestException('Invalid invitation token');
    }

    if (invitation.usedAt) {
      throw new BadRequestException('Invitation has already been used');
    }

    if (new Date() > invitation.expiresAt) {
      throw new BadRequestException('Invitation has expired');
    }

    // Find the associated user
    if (!invitation.userGuid) {
      throw new NotFoundException('Invitation is not linked to a user');
    }

    const user = await this.userRepository.findOne({
      where: { guid: invitation.userGuid },
    });

    if (!user) {
      throw new NotFoundException('Associated user does not exist');
    }

    // Set the password and activate the user
    user.password = await bcrypt.hash(dto.password, 10);
    user.status = UserStatus.ACTIVE;

    await this.userRepository.save(user);

    // Mark the invitation as used
    invitation.usedAt = new Date();
    await this.invitationRepository.save(invitation);

    this.logger.log(`User ${user.username} activated via invitation`);

    return { message: 'Account activated, please log in' };
  }

  async getUser(guid: string) {
    const user = await this.userRepository.findOne({
      where: { guid },
      relations: ['userGroup'],
    });
    if (!user) {
      throw new NotFoundException('User does not exist');
    }

    return {
      guid: user.guid,
      name: user.username,
      display_name: user.displayName || '',
      email: user.email || '',
      note: user.note || '',
      status: user.status,
      is_admin: user.isAdmin,
      third_auth_type: user.thirdAuthType || '',
      strategy_guid: user.strategyGuid || '',
      user_group_guid: user.userGroupGuid || '',
      user_group_name: user.userGroup?.name || '',
      created_at: user.createdAt,
      updated_at: user.updatedAt,
      ...(user.avatar ? { avatar: user.avatar } : {}),
    };
  }

  async updateUser(guid: string, dto: UpdateUserDto, actorGuid: string) {
    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const user = await users.findOne({ where: { guid } });
      if (!user) throw new NotFoundException('User does not exist');
      if (dto.is_admin !== undefined) {
        throw new BadRequestException(
          'The system owner identity cannot be modified',
        );
      }
      if (
        dto.name !== undefined ||
        dto.display_name !== undefined ||
        dto.email !== undefined ||
        dto.note !== undefined
      ) {
        await this.authorizationService.assertUserMutation(
          actorGuid,
          guid,
          'users.edit',
          undefined,
          manager,
        );
      }
      if (dto.status !== undefined) {
        await this.authorizationService.assertUserMutation(
          actorGuid,
          guid,
          'users.status',
          undefined,
          manager,
        );
      }
      if (dto.user_group_guid !== undefined) {
        await this.authorizationService.assertUserMutation(
          actorGuid,
          guid,
          'user_groups.membership',
          undefined,
          manager,
        );
      }
      const previousStatus = user.status;
      if (dto.name !== undefined) {
        const existingUser = await users.findOne({
          where: { username: dto.name },
        });
        if (existingUser && existingUser.guid !== guid) {
          throw new BadRequestException('Username already exists');
        }
        user.username = dto.name;
      }
      if (dto.display_name !== undefined)
        user.displayName = dto.display_name || null;
      if (dto.email !== undefined) {
        if (dto.email) {
          const existingEmail = await users.findOne({
            where: { email: dto.email },
          });
          if (existingEmail && existingEmail.guid !== guid) {
            throw new BadRequestException('Email already exists');
          }
        }
        user.email = dto.email || null;
      }
      if (dto.note !== undefined) user.note = dto.note;
      if (dto.status !== undefined) user.status = dto.status;
      if (dto.user_group_guid !== undefined) {
        user.userGroupGuid = await this.userGroupService.resolveUserGroupGuid(
          dto.user_group_guid,
        );
      }
      await users.save(user);
      if (dto.status !== undefined && dto.status !== previousStatus) {
        await this.revokeActiveTokens([guid], manager);
      }
      return { message: 'User updated' };
    });
  }

  async updateCurrentUser(userId: string, dto: UpdateCurrentUserDto) {
    const user = await this.userRepository.findOne({
      where: { guid: userId },
    });
    if (!user) {
      throw new NotFoundException('User does not exist');
    }

    if (dto.display_name !== undefined) {
      user.displayName = dto.display_name || null;
    }

    if (dto.email !== undefined) {
      if (dto.email) {
        const existingEmail = await this.userRepository.findOne({
          where: { email: dto.email },
        });
        if (existingEmail && existingEmail.guid !== userId) {
          throw new BadRequestException('Email already exists');
        }
      }
      user.email = dto.email || null;
    }

    if (dto.note !== undefined) {
      user.note = dto.note;
    }

    await this.userRepository.save(user);

    return { message: 'User info updated' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .where('user.guid = :guid', { guid: userId })
        .addSelect('user.password')
        .addSelect('user.thirdAuthType')
        .getOne();

      if (!user) throw new NotFoundException('User does not exist');

      if (user.thirdAuthType) {
        throw new BadRequestException(
          'Third-party login users cannot change the password',
        );
      }

      if (!user.password) {
        throw new BadRequestException(
          'No password is set for the current account, please contact an administrator',
        );
      }

      const isPasswordValid = await bcrypt.compare(
        dto.current_password,
        user.password,
      );
      if (!isPasswordValid)
        throw new BadRequestException('Current password is incorrect');

      user.password = await bcrypt.hash(dto.new_password, 10);
      await manager.getRepository(User).save(user);
      await this.revokeActiveTokens([userId], manager);

      return { message: 'Password changed successfully' };
    });
  }

  async updateUserSecurity(
    guid: string,
    dto: UpdateUserSecurityDto,
    actorGuid: string,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const user = await users.findOne({ where: { guid } });
      if (!user) throw new NotFoundException('User does not exist');
      await this.authorizationService.assertUserMutation(
        actorGuid,
        guid,
        'users.security',
        undefined,
        manager,
      );
      const userInfo: UserInfo = user.getUserInfo();
      userInfo.other = userInfo.other || {};
      if (dto.tfa_enforce !== undefined)
        userInfo.other.tfa_enforce = dto.tfa_enforce;
      if (dto.email_verification !== undefined) {
        userInfo.email_verification = dto.email_verification;
      }
      if (dto.new_password !== undefined) {
        if (user.thirdAuthType) {
          throw new BadRequestException(
            'Third-party login users cannot change the password',
          );
        }
        user.password = await bcrypt.hash(dto.new_password, 10);
      }
      user.setUserInfo(userInfo);
      await users.save(user);
      await this.revokeActiveTokens([guid], manager);
    });
  }

  async deleteUser(guid: string, actorGuid: string) {
    await this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const user = await users.findOne({ where: { guid } });
      if (!user) throw new NotFoundException('User does not exist');
      await this.authorizationService.assertUserMutation(
        actorGuid,
        guid,
        'users.delete',
        undefined,
        manager,
      );
      await this.revokeActiveTokens([guid], manager);
      await users.remove(user);
    });
  }

  async forceLogout(userGuids: string[], actorGuid: string) {
    const uniqueGuids = [...new Set(userGuids)];
    await this.dataSource.transaction(async (manager) => {
      const users = await manager.getRepository(User).find({
        where: { guid: In(uniqueGuids) },
      });
      if (users.length !== uniqueGuids.length) {
        throw new NotFoundException('One or more users do not exist');
      }
      for (const user of users) {
        await this.authorizationService.assertUserMutation(
          actorGuid,
          user.guid,
          'users.force_logout',
          undefined,
          manager,
        );
      }
      await this.revokeActiveTokens(uniqueGuids, manager);
    });
    return { message: 'Forced logout successful' };
  }

  private async revokeActiveTokens(
    userGuids: string[],
    manager?: import('typeorm').EntityManager,
  ): Promise<void> {
    const uniqueGuids = [...new Set(userGuids)];
    if (uniqueGuids.length === 0) return;

    const tokenRepository =
      manager?.getRepository(UserToken) ?? this.userTokenRepository;
    await tokenRepository.update(
      { userGuid: In(uniqueGuids), isRevoked: false },
      { isRevoked: true },
    );
    const sessionRepository =
      manager?.getRepository(LoginSession) ?? this.loginSessionRepository;
    await sessionRepository.delete({ userGuid: In(uniqueGuids), used: false });
  }

  async batchUpdateStatus(dto: BatchStatusDto, actorGuid: string) {
    const { user_guids, status } = dto;
    const succeeded: string[] = [];
    const failed: { guid: string; reason: string }[] = [];

    await this.dataSource.transaction(async (manager) => {
      const users = await manager.getRepository(User).find({
        where: { guid: In(user_guids) },
      });
      if (users.length === 0)
        throw new NotFoundException('User does not exist');
      const foundGuids = new Set(users.map((u) => u.guid));
      for (const guid of user_guids) {
        if (!foundGuids.has(guid))
          failed.push({ guid, reason: 'User not found' });
      }
      const guidsToUpdate = user_guids.filter((guid) => foundGuids.has(guid));
      if (guidsToUpdate.length > 0) {
        await this.authorizationService.assertUsersMutation(
          actorGuid,
          guidsToUpdate,
          'users.status',
          manager,
        );
        const updateResult = await manager
          .getRepository(User)
          .update({ guid: In(guidsToUpdate) }, { status });
        if (updateResult.affected !== new Set(guidsToUpdate).size) {
          throw new ConflictException(
            'User info has changed, please try again',
          );
        }
        succeeded.push(...guidsToUpdate);
        if (status !== UserStatus.ACTIVE) {
          await this.revokeActiveTokens(guidsToUpdate, manager);
        }
      }
    });

    return {
      succeeded,
      failed,
      total: user_guids.length,
      succeededCount: succeeded.length,
      failedCount: failed.length,
    };
  }

  async batchUpdateSecurity(dto: BatchSecurityDto, actorGuid: string) {
    const { user_guids, tfa_enforce, email_verification } = dto;
    const uniqueGuids = [...new Set(user_guids)];

    await this.dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const users = await userRepository.find({
        where: { guid: In(uniqueGuids) },
      });

      if (!users.length || users.length !== uniqueGuids.length) {
        throw new NotFoundException('User does not exist');
      }

      await this.authorizationService.assertUsersMutation(
        actorGuid,
        uniqueGuids,
        'users.security',
        manager,
      );

      const usersByGuid = new Map(users.map((user) => [user.guid, user]));
      for (const guid of uniqueGuids) {
        const user = usersByGuid.get(guid)!;
        const userInfo: UserInfo = user.getUserInfo();
        userInfo.other = userInfo.other || {};

        if (tfa_enforce !== undefined) {
          userInfo.other.tfa_enforce = tfa_enforce;
        }

        if (email_verification !== undefined) {
          userInfo.email_verification = email_verification;
        }

        user.setUserInfo(userInfo);
        await userRepository.save(user);
      }
      await this.revokeActiveTokens(uniqueGuids, manager);
    });

    return { message: 'Bulk security settings updated' };
  }

  private ensureAvatarDir() {
    if (!fs.existsSync(AVATAR_DIR)) {
      fs.mkdirSync(AVATAR_DIR, { recursive: true });
    }
  }

  private removeAvatarFile(avatarPath: string) {
    const filename = path.basename(avatarPath.split('?')[0]);
    const fullPath = path.join(AVATAR_DIR, filename);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  private buildUserResponse(user: User, isProtected = user.isAdmin) {
    const response: Record<string, unknown> = {
      guid: user.guid,
      name: user.username,
      display_name: user.displayName || '',
      email: user.email || '',
      note: user.note || '',
      status: user.status,
      is_admin: user.isAdmin,
      is_protected: isProtected,
      user_group_guid: user.userGroupGuid || '',
      user_group_name: user.userGroup?.name || '',
    };
    if (user.avatar) {
      response.avatar = user.avatar;
    }
    return response;
  }

  async uploadAvatar(userGuid: string, file: Express.Multer.File) {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        'Unsupported image format; only JPG, PNG and WebP are supported',
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('Image size cannot exceed 2MB');
    }

    const user = await this.userRepository.findOne({
      where: { guid: userGuid },
    });
    if (!user) {
      throw new NotFoundException('User does not exist');
    }

    if (user.avatar) {
      this.removeAvatarFile(user.avatar);
    }

    this.ensureAvatarDir();

    const filename = `${userGuid}.webp`;
    const relativePath = `/api/avatars/${filename}?v=${Date.now()}`;
    const fullPath = path.join(AVATAR_DIR, filename);

    await sharp(file.buffer)
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'center' })
      .webp({ quality: 85 })
      .toFile(fullPath);

    user.avatar = relativePath;
    await this.userRepository.save(user);

    return this.buildUserResponse(user);
  }

  async deleteAvatar(userGuid: string) {
    const user = await this.userRepository.findOne({
      where: { guid: userGuid },
    });
    if (!user) {
      throw new NotFoundException('User does not exist');
    }

    if (!user.avatar) {
      throw new NotFoundException('User has no avatar set');
    }

    this.removeAvatarFile(user.avatar);

    user.avatar = null;
    await this.userRepository.save(user);

    return this.buildUserResponse(user);
  }
}
