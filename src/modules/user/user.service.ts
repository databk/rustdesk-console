import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { User, UserStatus, UserInfo } from './entities/user.entity';
import { UserToken } from './entities/user-token.entity';
import { DeviceGroupUserPermission } from '../device-group/entities/device-group-user-permission.entity';
import { UserUserPermission } from '../device-group/entities/user-user-permission.entity';
import {
  CreateUserDto,
  InviteUserDto,
  UpdateUserDto,
  UpdateUserSecurityDto,
  UpdateCurrentUserDto,
  BatchStatusDto,
  BatchSecurityDto,
} from './dto/user.dto';

const AVATAR_DIR = path.join(process.cwd(), 'uploads', 'avatars');
const AVATAR_SIZE = 256;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 2 * 1024 * 1024;

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserToken)
    private userTokenRepository: Repository<UserToken>,
    @InjectRepository(DeviceGroupUserPermission)
    private deviceGroupUserPermissionRepository: Repository<DeviceGroupUserPermission>,
    @InjectRepository(UserUserPermission)
    private userUserPermissionRepository: Repository<UserUserPermission>,
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
        .where('user.status = :status', {
          status: parseInt(status || '1') || UserStatus.ACTIVE,
        });

      if (name) {
        queryBuilder.andWhere('user.username LIKE :name', {
          name: `%${name}%`,
        });
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
        data: users.map((u) => {
          const item: Record<string, unknown> = {
            guid: u.guid,
            name: u.username,
            email: u.email || '',
            note: u.note || '',
            status: u.status,
            is_admin: u.isAdmin,
          };
          if (u.avatar) {
            item.avatar = u.avatar;
          }
          return item;
        }),
        total,
      };
    }

    const queryBuilder = this.userRepository
      .createQueryBuilder('user')
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
      queryBuilder.andWhere('user.username LIKE :name', { name: `%${name}%` });
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
      data: users.map((u) => {
        const item: Record<string, unknown> = {
          guid: u.guid,
          name: u.username,
          email: u.email || '',
          note: u.note || '',
          status: u.status,
          is_admin: u.isAdmin,
        };
        if (u.avatar) {
          item.avatar = u.avatar;
        }
        return item;
      }),
      total,
    };
  }

  async createUser(dto: CreateUserDto) {
    const { name, password, email, note } = dto;

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
    user.email = email || '';
    user.password = await bcrypt.hash(password, 10);
    user.note = note || '';
    user.status = UserStatus.ACTIVE;
    user.isAdmin = false;

    await this.userRepository.save(user);

    return { message: '用户创建成功' };
  }

  async inviteUser(dto: InviteUserDto) {
    const { email, name, note } = dto;

    const existingUser = await this.userRepository.findOne({
      where: { email },
    });
    if (existingUser) {
      throw new BadRequestException('邮箱已存在');
    }

    const user = new User();
    user.guid = uuidv4();
    user.username = name;
    user.email = email;
    user.password = '';
    user.note = note || '';
    user.status = UserStatus.UNVERIFIED;
    user.isAdmin = false;

    await this.userRepository.save(user);

    return { message: '邀请发送成功' };
  }

  async getUser(guid: string) {
    const user = await this.userRepository.findOne({
      where: { guid },
    });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return {
      guid: user.guid,
      name: user.username,
      email: user.email || '',
      note: user.note || '',
      status: user.status,
      is_admin: user.isAdmin,
      third_auth_type: user.thirdAuthType || '',
      strategy_guid: user.strategyGuid || '',
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

    if (dto.email !== undefined) {
      if (dto.email) {
        const existingEmail = await this.userRepository.findOne({
          where: { email: dto.email },
        });
        if (existingEmail && existingEmail.guid !== guid) {
          throw new BadRequestException('邮箱已存在');
        }
      }
      user.email = dto.email;
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

    if (dto.name !== undefined) {
      const existingUser = await this.userRepository.findOne({
        where: { username: dto.name },
      });
      if (existingUser && existingUser.guid !== userId) {
        throw new BadRequestException('用户名已存在');
      }
      user.username = dto.name;
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
      user.email = dto.email;
    }

    if (dto.note !== undefined) {
      user.note = dto.note;
    }

    await this.userRepository.save(user);

    return { message: '用户信息已更新' };
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
    const normalizedPath = avatarPath.startsWith('/')
      ? avatarPath.slice(1)
      : avatarPath;
    const fullPath = path.join(process.cwd(), normalizedPath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  private buildUserResponse(user: User) {
    const response: Record<string, unknown> = {
      guid: user.guid,
      name: user.username,
      email: user.email || '',
      note: user.note || '',
      status: user.status,
      is_admin: user.isAdmin,
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
