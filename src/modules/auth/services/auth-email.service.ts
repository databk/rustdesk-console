import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { User, UserStatus, UserInfo } from '../../user/entities/user.entity';
import { EmailVerificationSession } from '../entities/email-verification-session.entity';
import { LoginDto } from '../dto/auth.dto';
import { EmailService } from '../../email/email.service';

/**
 * 邮箱登录响应接口
 * 定义邮箱验证码登录成功后返回的数据结构
 */
export interface LoginResponse {
  /** 访问令牌 */
  access_token?: string;
  /** 响应类型 */
  type: string;
  /** TFA类型 */
  tfa_type?: string;
  /** 密钥 */
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
 * AuthEmailService
 * 负责邮箱验证码认证的子服务
 *
 * 与主服务关系：
 * 被AuthService委托处理邮箱相关操作
 *
 * 调用上下文：
 * 包括验证码生成、发送和验证
 */
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);
  /** 验证码有效期（分钟） */
  private readonly VERIFICATION_CODE_EXPIRY_MINUTES = 5;

  constructor(
    @InjectRepository(EmailVerificationSession)
    private verificationSessionRepository: Repository<EmailVerificationSession>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private emailService: EmailService,
  ) {}

  /**
   * 发起邮箱验证
   * 生成6位验证码并发送邮件，用于登录的第二步验证
   *
   * @param user 用户对象
   * @returns 登录响应，包含验证密钥
   * @throws BadRequestException 当邮件发送失败时抛出
   */
  async initiateEmailVerification(user: User): Promise<LoginResponse> {
    // 生成6位随机验证码
    const code = Math.random().toString().slice(-6);

    // 生成secret（用于关联两次请求）
    const secret = uuidv4();

    // 计算过期时间
    const expiresAt = new Date();
    expiresAt.setMinutes(
      expiresAt.getMinutes() + this.VERIFICATION_CODE_EXPIRY_MINUTES,
    );

    // 删除该用户之前的验证会话
    await this.verificationSessionRepository.delete({
      userGuid: user.guid,
      used: false,
    });

    // 创建验证会话
    const session = this.verificationSessionRepository.create({
      guid: uuidv4(),
      secret,
      userGuid: user.guid,
      email: user.email,
      code,
      expiresAt,
      used: false,
    });
    await this.verificationSessionRepository.save(session);

    // 发送验证码邮件
    const sent = await this.emailService.sendVerificationCode(user.email, code);
    if (!sent) {
      throw new BadRequestException('发送验证码邮件失败，请稍后重试');
    }

    this.logger.log(
      `用户 ${user.username} 登录需要邮箱验证，验证码已发送至 ${user.email}`,
    );

    return {
      type: 'email_check',
      tfa_type: 'email_check',
      secret,
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

  /**
   * 邮箱验证码登录（第二步验证）
   * 验证用户输入的验证码并完成登录流程
   *
   * @param loginDto 登录信息
   * @param generateToken Token生成函数
   * @param createOrUpdateDevice 设备创建/更新函数（可选）
   * @returns 登录响应
   * @throws BadRequestException 当验证参数不完整时抛出
   * @throws UnauthorizedException 当验证失败或用户状态异常时抛出
   */
  async handleEmailCodeLogin(
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
    const { username, verificationCode, secret, id, uuid, deviceInfo } =
      loginDto;

    // 验证参数完整性
    if (!username || !verificationCode || !secret) {
      throw new BadRequestException('验证参数不完整');
    }

    // 查找验证会话
    const session = await this.verificationSessionRepository.findOne({
      where: {
        secret,
        used: false,
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!session) {
      throw new UnauthorizedException('验证码已过期或无效，请重新登录');
    }

    // 验证验证码
    if (session.code !== verificationCode) {
      throw new UnauthorizedException('验证码错误');
    }

    // 查找用户
    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('user.username = :username OR user.email = :email', {
        username,
        email: username,
      })
      .addSelect('user.info')
      .addSelect('user.thirdAuthType')
      .getOne();

    if (!user || user.guid !== session.userGuid) {
      throw new UnauthorizedException('用户信息不匹配');
    }

    // 检查用户状态
    if (user.status === UserStatus.DISABLED) {
      // UserStatus.DISABLED
      throw new UnauthorizedException('账户已被禁用');
    }

    // 标记验证会话为已使用
    session.used = true;
    await this.verificationSessionRepository.save(session);

    // 创建设备记录
    if (createOrUpdateDevice && (id || uuid)) {
      await createOrUpdateDevice(user.guid, id, uuid, deviceInfo);
    }

    // 生成Token
    const token = await generateToken(user, id, uuid);

    this.logger.log(`用户 ${user.username} 邮箱验证成功，已登录`);

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
