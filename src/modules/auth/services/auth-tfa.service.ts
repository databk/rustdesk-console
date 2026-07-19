import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { authenticator } from 'otplib';
import { User, UserStatus } from '../../user/entities/user.entity';
import { LoginDto, DeviceInfoDto } from '../dto/auth.dto';
import { LoginResponse } from '../../../common/interfaces';

@Injectable()
export class AuthTfaService {
  private readonly logger = new Logger(AuthTfaService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
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

  /**
   * 验证字符串是否为有效的 TFA 密钥格式（Base32）
   * 用于区分 TFA secret 和邮箱验证的 UUID secret，
   * 防止用户通过伪造 tfaCode 控制安全敏感路由
   *
   * @param secret 待验证的字符串
   * @returns 是否为有效的 Base32 格式 TFA 密钥
   */
  isTfaSecret(secret: string): boolean {
    // TFA 密钥为 Base32 编码（仅包含 A-Z, 2-7），长度通常为 16 或 32
    // 邮箱验证的 secret 为 UUID 格式（包含小写字母和连字符）
    return /^[A-Z2-7]+=*$/i.test(secret) && secret.length >= 16;
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

    const isValidTfa = this.verifyTfaCode(secret, tfaCode);
    if (!isValidTfa) {
      throw new UnauthorizedException({ error: '双因素认证验证码错误' });
    }

    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('user.username = :username OR user.email = :email', {
        username,
        email: username,
      })
      .addSelect('user.tfaSecret')
      .addSelect('user.info')
      .addSelect('user.thirdAuthType')
      .addSelect('user.avatar')
      .getOne();

    if (!user) {
      throw new UnauthorizedException({ error: '用户不存在' });
    }

    if (user.tfaSecret !== secret) {
      throw new UnauthorizedException({ error: '双因素认证参数无效' });
    }

    if (user.status === UserStatus.DISABLED) {
      throw new UnauthorizedException({ error: '账户已被禁用' });
    }

    if (createOrUpdateDevice && (id || uuid)) {
      await createOrUpdateDevice(user.guid, id, uuid, deviceInfo);
    }

    const token = await generateToken(user, id, uuid);

    this.logger.log(`用户 ${username} TFA认证成功，已登录`);

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
