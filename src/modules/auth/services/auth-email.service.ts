import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { User, UserStatus } from '../../user/entities/user.entity';
import { LoginDto } from '../dto/auth.dto';
import { EmailService } from '../../email/email.service';
import { LoginResponse } from '../../../common/interfaces';
import { EMAIL_VERIFICATION_CODE_EXPIRY_MINUTES } from '../auth.constants';
import { LoginSessionService } from './login-session.service';
import { AuthUserHelper } from './auth-user.helper';
import { AuthLoginHelper, LoginContext } from './auth-login.helper';
import { UserPayload } from './auth-response.helper';

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

  constructor(
    private readonly loginSessionService: LoginSessionService,
    private readonly authUserHelper: AuthUserHelper,
    private readonly authLoginHelper: AuthLoginHelper,
    private emailService: EmailService,
  ) {}

  /**
   * 发起邮箱验证
   * 生成6位验证码并发送邮件，用于登录的第二步验证
   *
   * @param user 用户对象
   * @param buildUserPayload 构建用户信息载荷的回调函数
   * @returns 登录响应，包含会话标识符 secret（实际为 guid）
   * @throws BadRequestException 当邮件发送失败时抛出
   */
  async initiateEmailVerification(
    user: User,
    buildUserPayload: (user: User) => UserPayload,
  ): Promise<LoginResponse> {
    if (!user.email) {
      throw new BadRequestException({
        error: '用户未设置邮箱，无法进行邮箱验证',
      });
    }

    const code = Math.random().toString().slice(-6);

    const session = await this.loginSessionService.createSession({
      userGuid: user.guid,
      method: 'email',
      email: user.email,
      code,
      expiryMinutes: EMAIL_VERIFICATION_CODE_EXPIRY_MINUTES,
      deleteExisting: true,
    });

    const sent = await this.emailService.sendVerificationCode(user.email, code);
    if (!sent) {
      throw new BadRequestException({
        error: '发送验证码邮件失败，请稍后重试',
      });
    }

    this.logger.log(
      `用户 ${user.username} 登录需要邮箱验证，验证码已发送至 ${user.email}`,
    );

    return {
      type: 'email_check',
      tfa_type: 'email_check',
      secret: session.guid,
      user: buildUserPayload(user),
    };
  }

  /**
   * 邮箱验证码登录（第二步验证）
   * 验证用户输入的验证码并完成登录流程
   *
   * @param loginDto 登录信息
   * @param context 登录上下文（回调集合）
   * @returns 登录响应
   * @throws BadRequestException 当验证参数不完整时抛出
   * @throws UnauthorizedException 当验证失败或用户状态异常时抛出
   */
  async handleEmailCodeLogin(
    loginDto: LoginDto,
    context: LoginContext,
  ): Promise<LoginResponse> {
    const { username, verificationCode, secret, id, uuid, deviceInfo } =
      loginDto;

    if (!username || !verificationCode || !secret) {
      throw new BadRequestException({ error: '验证参数不完整' });
    }

    const session = await this.loginSessionService.findByGuid(secret, {
      method: 'email',
      used: false,
      checkExpiry: true,
    });

    if (!session) {
      throw new UnauthorizedException({
        error: '验证码已过期或无效，请重新登录',
      });
    }

    if (session.code !== verificationCode) {
      throw new UnauthorizedException({ error: '验证码错误' });
    }

    const user = await this.authUserHelper.findByUsernameOrEmail(username);

    if (!user || user.guid !== session.userGuid) {
      throw new UnauthorizedException({ error: '用户信息不匹配' });
    }

    if (user.status === UserStatus.DISABLED) {
      throw new UnauthorizedException({ error: '账户已被禁用' });
    }

    return this.authLoginHelper.completeLogin({
      user,
      session,
      context,
      deviceId: id,
      deviceUuid: uuid,
      deviceInfo,
      successMessage: `用户 ${user.username} 邮箱验证成功，已登录`,
    });
  }
}
