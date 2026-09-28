import { Injectable } from '@nestjs/common';
import { User } from '../../user/entities/user.entity';
import { LoginResponse } from '../../../common/interfaces';

/** 登录响应中的用户载荷类型（去除可选性，保证字段完整） */
export type UserPayload = NonNullable<LoginResponse['user']>;

/**
 * 认证响应构建助手
 * 统一构建登录响应中的用户信息载荷，消除多处重复实现
 */
@Injectable()
export class AuthResponseHelper {
  /**
   * 构建登录响应中的用户信息载荷
   * 用于 login / TFA / 邮箱验证码 / Passkey 等所有登录流程
   *
   * tfaSecret / password 在实体上是 select:false 字段：
   * 只有查询确实加载了该字段时才返回对应状态，
   * 避免把“未查询”误报成“未启用”。
   */
  buildUserPayload(user: User): UserPayload {
    const secretFields = user as unknown as {
      tfaSecret?: string | null;
      password?: string | null;
    };

    return {
      guid: user.guid,
      name: user.username,
      display_name: user.displayName || undefined,
      email: user.email || undefined,
      note: user.note || undefined,
      status: user.status,
      info: user.getUserInfo(),
      is_admin: user.isAdmin,
      third_auth_type: user.thirdAuthType || undefined,
      ...(user.avatar ? { avatar: user.avatar } : {}),
      ...(secretFields.tfaSecret !== undefined
        ? { tfa_enabled: !!secretFields.tfaSecret }
        : {}),
      ...(secretFields.password !== undefined
        ? { has_password: !!secretFields.password }
        : {}),
    };
  }

  /**
   * 构建 currentUser 接口的响应载荷
   * 在 buildUserPayload 基础上额外包含 verifier 字段
   *
   * 调用方需加载 tfaSecret / password 字段，
   * 保证前端安全设置页能拿到准确的 2FA 状态。
   */
  buildCurrentUserPayload(user: User): Record<string, unknown> {
    return {
      ...this.buildUserPayload(user),
      tfa_enabled: !!user.tfaSecret,
      has_password: !!user.password,
      verifier: user.verifier || undefined,
    };
  }
}
