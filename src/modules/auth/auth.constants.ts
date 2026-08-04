/**
 * 认证模块常量
 * 集中管理登录相关配置，避免魔法数字和散落的字符串字面量
 */

/** JWT Token 有效期（天） */
export const TOKEN_EXPIRY_DAYS = 30;

/** TFA 登录会话有效期（分钟） */
export const TFA_LOGIN_SESSION_EXPIRY_MINUTES = 5;

/** 邮箱验证码有效期（分钟） */
export const EMAIL_VERIFICATION_CODE_EXPIRY_MINUTES = 5;

/** Passkey 会话有效期（分钟） */
export const PASSKEY_SESSION_EXPIRY_MINUTES = 5;

/** JWT 默认密钥（仅用于开发环境，生产环境必须通过 JWT_SECRET 覆盖） */
export const JWT_DEFAULT_SECRET =
  'rustdesk-api-secret-key-change-in-production';

/**
 * 登录类型枚举
 * 对应 LoginDto.type 字段，标识客户端请求的登录流程
 */
export enum LoginType {
  /** 标准账号密码登录 */
  ACCOUNT = 'account',
  /** 手机号登录 */
  MOBILE = 'mobile',
  /** 短信验证码登录 */
  SMS_CODE = 'sms_code',
  /** 邮箱验证码登录（二次验证） */
  EMAIL_CODE = 'email_code',
  /** TFA 验证码登录（二次验证） */
  TFA_CODE = 'tfa_code',
  /** Passkey 双因素认证检查 */
  PASSKEY_CHECK = 'passkey_check',
}

/** LoginDto.type 允许的取值列表，供 class-validator @IsIn 使用 */
export const LOGIN_TYPE_VALUES: string[] = Object.values(LoginType);
