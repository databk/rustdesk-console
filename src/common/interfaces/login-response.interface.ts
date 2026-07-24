import { UserInfo } from '../../modules/user/entities/user.entity';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/types';

/**
 * 登录响应接口
 * 定义登录成功后返回的数据结构
 * 适用于所有认证方式（密码登录、TFA、邮箱验证码、OIDC、Passkey等）
 */
export interface LoginResponse {
  /** 访问令牌，仅在登录成功时返回 */
  access_token?: string;
  /** 响应类型，用于标识登录流程的状态 */
  type: string;
  /** 双因素认证类型，仅在需要TFA时返回 */
  tfa_type?: string;
  /** 登录会话标识符（UUID），由服务端在需要二次验证时返回，客户端在后续请求中回传，用于跟踪一次登录 */
  secret?: string;
  /** Passkey 认证选项，仅在需要 Passkey 验证时返回，供浏览器调用 navigator.credentials.get() */
  passkey_options?: PublicKeyCredentialRequestOptionsJSON;
  /** 用户信息 */
  user?: {
    /** 用户名 */
    name: string;
    /** 显示名称 */
    display_name?: string;
    /** 头像 URL */
    avatar?: string;
    /** 邮箱地址 */
    email?: string;
    /** 用户备注 */
    note?: string;
    /** 用户状态 */
    status: number;
    /** 用户信息配置 */
    info?: UserInfo;
    /** 是否为管理员 */
    is_admin: boolean;
    /** 第三方认证类型 */
    third_auth_type?: string;
  };
}
