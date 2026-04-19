import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { authenticator } from 'otplib';
import { User, UserStatus, UserInfo } from '../../user/entities/user.entity';
import { LoginDto } from '../dto/auth.dto';

/**
 * TFA登录响应接口
 * 定义双因素认证登录成功后返回的数据结构
 */
export interface LoginResponse {
  /** 访问令牌 */
  access_token?: string;
  /** 响应类型 */
  type: string;
  /** TFA类型 */
  tfa_type?: string;
  /** TFA密钥 */
  secret?: string;
  /** 用户信息 */
  user?: {
    /** 用户名 */
    name: string;
    /** 邮箱 */
    email?: string;
    /** 备注 */
    note?: string;
    /** 状态 */
    status: number;
    /** 用户信息 */
    info?: UserInfo;
    /** 是否管理员 */
    is_admin: boolean;
    /** 第三方认证类型 */
    third_auth_type?: string;
  };
}

@Injectable()
/**
 * AuthTfaService
 * 负责双因素认证的子服务
 *
 * 与主服务关系：
 * 被AuthService委托处理TFA相关操作
 *
 * 调用上下文：
 * 包括TFA密钥生成、验证和启用/禁用
 */
export class AuthTfaService {
  private readonly logger = new Logger(AuthTfaService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  /**
   * 验证TFA验证码
   * 使用TOTP算法验证用户输入的验证码是否正确
   *
   * @param secret TFA密钥
   * @param code 用户输入的验证码
   * @returns 验证是否成功
   */
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
   * 双因素认证登录
   * 验证TFA验证码并完成登录流程
   *
   * @param loginDto 登录信息
   * @param generateToken Token生成函数
   * @param createOrUpdateDevice 设备创建/更新函数（可选）
   * @returns 登录响应
   * @throws BadRequestException 当TFA参数不完整时抛出
   * @throws UnauthorizedException 当验证失败或用户状态异常时抛出
   */
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
      deviceInfo?: Record<string, any>,
    ) => Promise<void>,
  ): Promise<LoginResponse> {
    const { username, tfaCode, secret, id, uuid, deviceInfo } = loginDto;

    // 验证参数完整性
    if (!tfaCode || !secret) {
      throw new BadRequestException('双因素认证参数不完整');
    }

    // 验证TFA代码
    const isValidTfa = this.verifyTfaCode(secret, tfaCode);
    if (!isValidTfa) {
      throw new UnauthorizedException('双因素认证验证码错误');
    }

    // 查找用户
    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('user.username = :username OR user.email = :email', {
        username,
        email: username,
      })
      .addSelect('user.tfaSecret')
      .addSelect('user.info')
      .addSelect('user.thirdAuthType')
      .getOne();

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    // 验证secret是否与用户的tfaSecret匹配
    if (user.tfaSecret !== secret) {
      throw new UnauthorizedException('双因素认证参数无效');
    }

    // 检查用户状态
    if (user.status === UserStatus.DISABLED) {
      // UserStatus.DISABLED
      throw new UnauthorizedException('账户已被禁用');
    }

    // 创建设备记录
    if (createOrUpdateDevice && (id || uuid)) {
      await createOrUpdateDevice(user.guid, id, uuid, deviceInfo);
    }

    // 生成Token
    const token = await generateToken(user, id, uuid);

    this.logger.log(`用户 ${username} TFA认证成功，已登录`);

    return {
      access_token: token,
      type: 'access_token',
      user: {
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
