import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
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
import { EmailService } from '../email/email.service';
import { GeneralSettingsService } from '../settings/services/general-settings.service';

const AVATAR_DIR = path.join(process.cwd(), 'uploads', 'avatars');
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

      return {
        data: users.map((user) => this.buildUserResponse(user)),
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

    return {
      data: users.map((user) => this.buildUserResponse(user)),
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
      throw new BadRequestException('用户名已存在');
    }

    if (email) {
      const existingEmail = await this.userRepository.findOne({
        where: { email },
      });
      if (existingEmail) {
        throw new BadRequestException('邮箱已存在');
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

    return { message: '用户创建成功' };
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
      throw new BadRequestException('邮箱已存在');
    }

    const existingUsername = await this.userRepository.findOne({
      where: { username: name },
    });
    if (existingUsername) {
      throw new BadRequestException('用户名已存在');
    }

    // 创建用户（UNVERIFIED 状态，空密码）
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

    // 生成邀请令牌
    const token = crypto.randomBytes(INVITATION_TOKEN_BYTES).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

    // 保存邀请记录
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

    // 发送邀请邮件
    const { effectiveFrontendUrl } =
      await this.generalSettingsService.getSiteSettings();
    const consoleUrl = effectiveFrontendUrl;
    const inviteUrl = `${consoleUrl}/#/invite?token=${token}`;
    const emailSent = await this.emailService.sendInvitation(
      email,
      inviteUrl,
      `${INVITATION_EXPIRY_DAYS}天`,
    );

    if (!emailSent) {
      this.logger.warn(
        `邀请邮件发送失败，但用户已创建: ${email}。邀请令牌: ${token}`,
      );
    }

    return {
      message: emailSent
        ? '邀请发送成功'
        : '用户已创建，但邀请邮件发送失败，请检查SMTP配置',
      token: emailSent ? undefined : token,
    };
  }

  /**
   * 验证邀请令牌
   * 返回邀请信息，用于前端展示邀请页面
   */
  async verifyInvitation(token: string) {
    const invitation = await this.invitationRepository.findOne({
      where: { token },
    });

    if (!invitation) {
      throw new BadRequestException('邀请令牌无效');
    }

    if (invitation.usedAt) {
      throw new BadRequestException('邀请已被使用');
    }

    if (new Date() > invitation.expiresAt) {
      throw new BadRequestException('邀请已过期');
    }

    return {
      name: invitation.name,
      display_name: invitation.displayName || '',
      email: invitation.email,
    };
  }

  /**
   * 接受邀请
   * 验证令牌、设置密码、激活用户
   */
  async acceptInvitation(dto: AcceptInvitationDto) {
    const invitation = await this.invitationRepository.findOne({
      where: { token: dto.token },
    });

    if (!invitation) {
      throw new BadRequestException('邀请令牌无效');
    }

    if (invitation.usedAt) {
      throw new BadRequestException('邀请已被使用');
    }

    if (new Date() > invitation.expiresAt) {
      throw new BadRequestException('邀请已过期');
    }

    // 查找关联用户
    if (!invitation.userGuid) {
      throw new NotFoundException('邀请未关联用户');
    }

    const user = await this.userRepository.findOne({
      where: { guid: invitation.userGuid },
    });

    if (!user) {
      throw new NotFoundException('关联用户不存在');
    }

    // 设置密码并激活用户
    user.password = await bcrypt.hash(dto.password, 10);
    user.status = UserStatus.ACTIVE;

    await this.userRepository.save(user);

    // 标记邀请已使用
    invitation.usedAt = new Date();
    await this.invitationRepository.save(invitation);

    this.logger.log(`用户 ${user.username} 已通过邀请激活`);

    return { message: '账户已激活，请登录' };
  }

  async getUser(guid: string) {
    const user = await this.userRepository.findOne({
      where: { guid },
      relations: ['userGroup'],
    });
    if (!user) {
      throw new NotFoundException('用户不存在');
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

  async updateUser(guid: string, dto: UpdateUserDto) {
    const user = await this.userRepository.findOne({
      where: { guid },
    });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    if (dto.name !== undefined) {
      const existingUser = await this.userRepository.findOne({
        where: { username: dto.name },
      });
      if (existingUser && existingUser.guid !== guid) {
        throw new BadRequestException('用户名已存在');
      }
      user.username = dto.name;
    }

    if (dto.display_name !== undefined) {
      user.displayName = dto.display_name || null;
    }

    if (dto.email !== undefined) {
      if (dto.email) {
        const existingEmail = await this.userRepository.findOne({
          where: { email: dto.email },
        });
        if (existingEmail && existingEmail.guid !== guid) {
          throw new BadRequestException('邮箱已存在');
        }
      }
      user.email = dto.email || null;
    }

    if (dto.note !== undefined) {
      user.note = dto.note;
    }

    if (dto.status !== undefined) {
      user.status = dto.status;
    }

    if (dto.is_admin !== undefined) {
      user.isAdmin = dto.is_admin;
    }

    if (dto.user_group_guid !== undefined) {
      user.userGroupGuid = await this.userGroupService.resolveUserGroupGuid(
        dto.user_group_guid,
      );
    }

    await this.userRepository.save(user);

    return { message: '用户已更新' };
  }

  async updateCurrentUser(userId: string, dto: UpdateCurrentUserDto) {
    const user = await this.userRepository.findOne({
      where: { guid: userId },
    });
    if (!user) {
      throw new NotFoundException('用户不存在');
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
          throw new BadRequestException('邮箱已存在');
        }
      }
      user.email = dto.email || null;
    }

    if (dto.note !== undefined) {
      user.note = dto.note;
    }

    await this.userRepository.save(user);

    return { message: '用户信息已更新' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('user.guid = :guid', { guid: userId })
      .addSelect('user.password')
      .addSelect('user.thirdAuthType')
      .getOne();

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    if (user.thirdAuthType) {
      throw new BadRequestException('第三方登录用户不支持修改密码');
    }

    if (!user.password) {
      throw new BadRequestException('当前账户未设置密码，请联系管理员');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.current_password,
      user.password,
    );
    if (!isPasswordValid) {
      throw new BadRequestException('当前密码错误');
    }

    user.password = await bcrypt.hash(dto.new_password, 10);
    await this.userRepository.save(user);

    return { message: '密码修改成功' };
  }

  async updateUserSecurity(guid: string, dto: UpdateUserSecurityDto) {
    const user = await this.userRepository.findOne({
      where: { guid },
    });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const userInfo: UserInfo = user.getUserInfo();
    userInfo.other = userInfo.other || {};

    if (dto.tfa_enforce !== undefined) {
      userInfo.other.tfa_enforce = dto.tfa_enforce;
    }

    if (dto.email_verification !== undefined) {
      userInfo.email_verification = dto.email_verification;
    }

    user.setUserInfo(userInfo);
    await this.userRepository.save(user);
  }

  async deleteUser(guid: string) {
    const user = await this.userRepository.findOne({
      where: { guid },
    });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    await this.userRepository.remove(user);
  }

  async forceLogout(userGuids: string[]) {
    const users = await this.userRepository.find({
      where: { guid: In(userGuids) },
    });

    if (users.length === 0) {
      throw new NotFoundException('用户不存在');
    }

    await this.userTokenRepository.update(
      { userGuid: In(userGuids), isRevoked: false },
      { isRevoked: true },
    );

    return { message: '强制登出成功' };
  }

  async batchUpdateStatus(dto: BatchStatusDto) {
    const { user_guids, status } = dto;
    const users = await this.userRepository.find({
      where: { guid: In(user_guids) },
    });

    if (users.length === 0) {
      throw new NotFoundException('用户不存在');
    }

    const foundGuids = new Set(users.map((u) => u.guid));
    const succeeded: string[] = [];
    const failed: { guid: string; reason: string }[] = [];

    for (const guid of user_guids) {
      if (!foundGuids.has(guid)) {
        failed.push({ guid, reason: 'User not found' });
      }
    }

    const guidsToUpdate = user_guids.filter((guid) => foundGuids.has(guid));

    if (guidsToUpdate.length > 0) {
      await this.userRepository
        .createQueryBuilder()
        .update(User)
        .set({ status })
        .where('guid IN (:...guids)', { guids: guidsToUpdate })
        .execute();

      succeeded.push(...guidsToUpdate);
    }

    return {
      succeeded,
      failed,
      total: user_guids.length,
      succeededCount: succeeded.length,
      failedCount: failed.length,
    };
  }

  async batchUpdateSecurity(dto: BatchSecurityDto) {
    const { user_guids, tfa_enforce, email_verification } = dto;
    const users = await this.userRepository.find({
      where: { guid: In(user_guids) },
    });

    if (users.length === 0) {
      throw new NotFoundException('用户不存在');
    }

    for (const user of users) {
      const userInfo: UserInfo = user.getUserInfo();
      userInfo.other = userInfo.other || {};

      if (tfa_enforce !== undefined) {
        userInfo.other.tfa_enforce = tfa_enforce;
      }

      if (email_verification !== undefined) {
        userInfo.email_verification = email_verification;
      }

      user.setUserInfo(userInfo);
      await this.userRepository.save(user);
    }

    return { message: '批量安全设置已更新' };
  }

  private ensureAvatarDir() {
    if (!fs.existsSync(AVATAR_DIR)) {
      fs.mkdirSync(AVATAR_DIR, { recursive: true });
    }
  }

  private removeAvatarFile(avatarPath: string) {
    const filename = path.basename(avatarPath);
    const fullPath = path.join(AVATAR_DIR, filename);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  private buildUserResponse(user: User) {
    const response: Record<string, unknown> = {
      guid: user.guid,
      name: user.username,
      display_name: user.displayName || '',
      email: user.email || '',
      note: user.note || '',
      status: user.status,
      is_admin: user.isAdmin,
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
      throw new BadRequestException('不支持的图片格式，仅支持 JPG、PNG、WebP');
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('图片大小不能超过 2MB');
    }

    const user = await this.userRepository.findOne({
      where: { guid: userGuid },
    });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    if (user.avatar) {
      this.removeAvatarFile(user.avatar);
    }

    this.ensureAvatarDir();

    const filename = `${userGuid}.webp`;
    const relativePath = `/api/avatars/${filename}`;
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
      throw new NotFoundException('用户不存在');
    }

    if (!user.avatar) {
      throw new NotFoundException('用户未设置头像');
    }

    this.removeAvatarFile(user.avatar);

    user.avatar = null;
    await this.userRepository.save(user);

    return this.buildUserResponse(user);
  }
}
