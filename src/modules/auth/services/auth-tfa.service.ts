import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { authenticator } from 'otplib';
import { v4 as uuidv4 } from 'uuid';
import { User, UserStatus } from '../../user/entities/user.entity';
import { LoginSession } from '../entities/login-session.entity';
import { LoginDto, DeviceInfoDto } from '../dto/auth.dto';
import { LoginResponse } from '../../../common/interfaces';

@Injectable()
export class AuthTfaService {
  private readonly logger = new Logger(AuthTfaService.name);
  /** TFA 登录会话有效期（分钟） */
  private readonly TFA_LOGIN_SESSION_EXPIRY_MINUTES = 5;

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(LoginSession)
    private loginSessionRepository: Repository<LoginSession>,
  ) {}

  verifyTfaCode(secret: string, code: string): boolean {
    try {
      return authenticator.verify({
        secret,
        token: code,
      });
    } catch (error) {
      this.logger.error('TFA 验证失败', error);
      return false;
    }
  }

  async setupTfa(
    userGuid: string,
    currentCode?: string,
  ): Promise<{ secret: string; otpauth_url: string }> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('user.guid = :guid', { guid: userGuid })
      .addSelect('user.tfaSecret')
      .addSelect('user.info')
      .getOne();

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const userInfo = user.getUserInfo();
    const isEnforced = !!userInfo?.other?.tfa_enforce;

    if (user.tfaSecret) {
      if (!isEnforced) {
        throw new BadRequestException('2FA已启用，如需重新设置请先禁用');
      }

      if (!currentCode) {
        throw new BadRequestException(
          '2FA已启用且为强制模式，重设需提供当前验证码',
        );
      }

      const isValid = this.verifyTfaCode(user.tfaSecret, currentCode);
      if (!isValid) {
        throw new UnauthorizedException('当前验证码错误');
      }
    }

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.username, 'RustDesk', secret);

    userInfo.other = userInfo.other || {};
    userInfo.other.tfa_pending_secret = secret;
    user.setUserInfo(userInfo);

    await this.userRepository.save(user);

    return {
      secret,
      otpauth_url: otpauthUrl,
    };
  }

  async verifyAndBindTfa(
    userGuid: string,
    code: string,
  ): Promise<{ message: string }> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('user.guid = :guid', { guid: userGuid })
      .addSelect('user.tfaSecret')
      .addSelect('user.info')
      .getOne();

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const userInfo = user.getUserInfo();
    const isEnforced = !!userInfo?.other?.tfa_enforce;

    if (user.tfaSecret && !isEnforced) {
      throw new BadRequestException('2FA已启用');
    }

    const other = userInfo.other || {};
    const pendingSecret = other.tfa_pending_secret as string | undefined;

    if (!pendingSecret) {
      throw new BadRequestException('请先调用setup接口生成2FA密钥');
    }

    const isValid = this.verifyTfaCode(pendingSecret, code);
    if (!isValid) {
      throw new UnauthorizedException('验证码错误，请重试');
    }

    user.tfaSecret = pendingSecret;

    delete other.tfa_pending_secret;
    userInfo.other = other;
    user.setUserInfo(userInfo);

    await this.userRepository.save(user);

    return { message: '2FA绑定成功' };
  }

  async disableTfa(
    userGuid: string,
    code: string,
  ): Promise<{ message: string }> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('user.guid = :guid', { guid: userGuid })
      .addSelect('user.tfaSecret')
      .addSelect('user.info')
      .getOne();

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    if (!user.tfaSecret) {
      throw new BadRequestException('2FA未启用');
    }

    const userInfo = user.getUserInfo();
    if (userInfo?.other?.tfa_enforce) {
      throw new BadRequestException('管理员已强制要求开启2FA，无法禁用');
    }

    const isValid = this.verifyTfaCode(user.tfaSecret, code);
    if (!isValid) {
      throw new UnauthorizedException('验证码错误');
    }

    user.tfaSecret = '';
    await this.userRepository.save(user);

    return { message: '2FA已禁用' };
  }

  /**
   * 发起 TFA 登录验证
   * 密码校验通过后，当用户启用了 TFA 时调用。
   *
   * 安全说明：
   * 创建一个一次性的登录会话，返回的 secret 字段实际是会话的 guid（UUID）。
   * 客户端在二次验证时通过 secret 字段回传此值。
   * TFA 密钥（tfaSecret）始终保留在服务端，绝不返回给客户端。
   *
   * @param user 已通过密码校验的用户
   * @param buildUserPayload 构建用户信息载荷的回调函数
   * @returns 登录响应，包含会话标识符 secret（实际为 guid），type 为 email_check 兼容客户端
   */
  async initiateTfaLogin(
    user: User,
    buildUserPayload: (user: User) => Record<string, unknown>,
  ): Promise<LoginResponse> {
    // 删除该用户之前未使用的验证会话，避免会话堆积
    await this.loginSessionRepository.delete({
      userGuid: user.guid,
      used: false,
    });

    const guid = uuidv4();
    const expiresAt = new Date();
    expiresAt.setMinutes(
      expiresAt.getMinutes() + this.TFA_LOGIN_SESSION_EXPIRY_MINUTES,
    );

    const session = this.loginSessionRepository.create({
      guid,
      userGuid: user.guid,
      method: 'tfa',
      expiresAt,
      used: false,
    });
    await this.loginSessionRepository.save(session);

    this.logger.log(`用户 ${user.username} 登录需要 TFA 验证，已创建会话`);

    // 返回 guid 作为会话标识符（通过 secret 字段，保持 API 兼容）
    return {
      type: 'email_check',
      tfa_type: 'tfa_check',
      secret: guid,
      user: buildUserPayload(user) as LoginResponse['user'],
    };
  }

  async handleTfaLogin(
    loginDto: LoginDto,
    generateToken: (
      user: User,
      deviceId?: string,
      deviceUuid?: string,
    ) => Promise<string>,
    createOrUpdateDevice?: (
      userGuid: string,
      deviceId?: string,
      deviceUuid?: string,
      deviceInfo?: DeviceInfoDto,
    ) => Promise<void>,
    buildUserPayload?: (user: User) => Record<string, unknown>,
  ): Promise<LoginResponse> {
    const { username, tfaCode, secret, id, uuid, deviceInfo } = loginDto;

    if (!tfaCode || !secret) {
      throw new BadRequestException({ error: '双因素认证参数不完整' });
    }

    // 通过会话标识符定位本次登录，secret 字段实际是会话 guid
    const session = await this.loginSessionRepository.findOne({
      where: {
        guid: secret,
        method: 'tfa',
        used: false,
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!session) {
      throw new UnauthorizedException({
        error: '登录会话已过期或无效，请重新登录',
      });
    }

    // 按会话绑定的用户查找，确保登录主体由服务端会话决定
    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('user.guid = :guid', { guid: session.userGuid })
      .addSelect('user.tfaSecret')
      .addSelect('user.info')
      .addSelect('user.thirdAuthType')
      .addSelect('user.avatar')
      .getOne();

    if (!user) {
      throw new UnauthorizedException({ error: '用户不存在' });
    }

    // 若客户端回传了用户名，校验与会话用户一致，防止会话替换攻击
    if (username && user.username !== username && user.email !== username) {
      throw new UnauthorizedException({ error: '用户信息不匹配' });
    }

    if (!user.tfaSecret) {
      throw new UnauthorizedException({ error: '双因素认证参数无效' });
    }

    // 对照服务端存储的 tfaSecret 验证 TFA 验证码
    const isValidTfa = this.verifyTfaCode(user.tfaSecret, tfaCode);
    if (!isValidTfa) {
      throw new UnauthorizedException({ error: '双因素认证验证码错误' });
    }

    if (user.status === UserStatus.DISABLED) {
      throw new UnauthorizedException({ error: '账户已被禁用' });
    }

    // 标记会话为已使用，防止重放
    session.used = true;
    await this.loginSessionRepository.save(session);

    if (createOrUpdateDevice && (id || uuid)) {
      await createOrUpdateDevice(user.guid, id, uuid, deviceInfo);
    }

    const token = await generateToken(user, id, uuid);

    this.logger.log(`用户 ${user.username} TFA认证成功，已登录`);

    return {
      access_token: token,
      type: 'access_token',
      user: buildUserPayload
        ? (buildUserPayload(user) as LoginResponse['user'])
        : {
            name: user.username,
            email: user.email || undefined,
            note: user.note || undefined,
            status: user.status,
            info: user.getUserInfo(),
            is_admin: user.isAdmin,
            third_auth_type: user.thirdAuthType || undefined,
          },
    };
  }
}
