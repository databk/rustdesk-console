import { Injectable, Logger } from '@nestjs/common';
import { User } from '../../user/entities/user.entity';
import { LoginSession } from '../entities/login-session.entity';
import { LoginResponse } from '../../../common/interfaces';
import { DeviceInfoDto } from '../dto/auth.dto';
import { LoginSessionService } from './login-session.service';
import { UserPayload } from './auth-response.helper';

/**
 * 登录上下文
 * 封装完成登录所需的三个回调，替代原先在 handleTfaLogin / handleEmailCodeLogin
 * 中散落的三个独立回调参数
 *
 * - generateToken: 生成 JWT Token（deviceInfo 由上下文内部处理）
 * - createOrUpdateDevice: 创建或更新设备绑定记录
 * - buildUserPayload: 构建登录响应中的用户信息载荷
 */
export interface LoginContext {
  generateToken: (
    user: User,
    deviceId?: string,
    deviceUuid?: string,
  ) => Promise<string>;
  createOrUpdateDevice: (
    userGuid: string,
    deviceId?: string,
    deviceUuid?: string,
    deviceInfo?: DeviceInfoDto,
  ) => Promise<void>;
  buildUserPayload: (user: User) => UserPayload;
}

/** completeLogin 方法的参数 */
export interface CompleteLoginParams {
  /** 已通过认证的用户 */
  user: User;
  /** 待标记为已使用的登录会话 */
  session: LoginSession;
  /** 登录上下文（回调集合） */
  context: LoginContext;
  /** 设备 ID */
  deviceId?: string;
  /** 设备 UUID */
  deviceUuid?: string;
  /** 设备信息 */
  deviceInfo?: DeviceInfoDto;
  /** 成功日志消息 */
  successMessage: string;
}

/**
 * 认证登录助手
 * 统一二次验证通过后的登录完成流程：
 * 标记会话已使用 → 创建/更新设备 → 生成 Token → 构建响应
 *
 * 消除 AuthTfaService / AuthEmailService / AuthPasskeyService 中的重复逻辑
 */
@Injectable()
export class AuthLoginHelper {
  private readonly logger = new Logger(AuthLoginHelper.name);

  constructor(private readonly loginSessionService: LoginSessionService) {}

  /**
   * 完成登录流程
   * 在二次验证（TFA / 邮箱验证码 / Passkey）通过后调用，
   * 统一处理会话标记、设备绑定、Token 生成和响应构建
   */
  async completeLogin(params: CompleteLoginParams): Promise<LoginResponse> {
    const {
      user,
      session,
      context,
      deviceId,
      deviceUuid,
      deviceInfo,
      successMessage,
    } = params;

    await this.loginSessionService.markSessionUsed(session);

    if (deviceId || deviceUuid) {
      await context.createOrUpdateDevice(
        user.guid,
        deviceId,
        deviceUuid,
        deviceInfo,
      );
    }

    const token = await context.generateToken(user, deviceId, deviceUuid);

    this.logger.log(successMessage);

    return {
      access_token: token,
      type: 'access_token',
      user: context.buildUserPayload(user),
    };
  }
}
