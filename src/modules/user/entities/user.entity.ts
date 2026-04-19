import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { UserToken } from './user-token.entity';

/**
 * 用户状态枚举
 * -1: 未验证邮箱
 * 0: 禁用
 * 1: 正常
 */
export enum UserStatus {
  UNVERIFIED = -1,
  DISABLED = 0,
  ACTIVE = 1,
}

/**
 * 用户信息设置
 */
export interface UserInfo {
  email_verification?: boolean;
  email_alarm_notification?: boolean;
  other?: Record<string, any>;
}

/**
 * 用户实体
 * 管理所有用户信息
 */
@Entity('users')
export class User {
  /**
   * 用户唯一标识符
   * UUID格式，用于唯一标识一个用户
   */
  @PrimaryColumn()
  guid: string;

  /**
   * 用户名
   * 用于登录的唯一标识
   */
  @Column({ unique: true })
  @Index()
  username: string;

  /**
   * 邮箱地址
   * 用于邮箱验证和通知
   */
  @Column({ unique: true, nullable: true })
  @Index()
  email: string;

  /**
   * 密码
   * 加密存储的用户密码
   */
  @Column({ select: false, nullable: true })
  password: string;

  /**
   * 备注
   * 用户的详细说明信息
   */
  @Column({ nullable: true })
  note: string;

  /**
   * 验证器
   * 双因素认证密钥
   */
  @Column({ nullable: true, select: false })
  verifier: string;

  /**
   * 用户状态
   * -1: 未验证邮箱, 0: 禁用, 1: 正常
   */
  @Column({
    type: 'integer',
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  /**
   * 是否为管理员
   * true - 拥有管理员权限
   * false - 普通用户
   */
  @Column({ default: false })
  isAdmin: boolean;

  /**
   * 邮箱验证码
   * 用于邮箱验证的临时验证码
   */
  @Column({ nullable: true, select: false })
  emailVerificationCode: string;

  /**
   * 双因素认证密钥
   * 用于 TOTP 认证的密钥
   */
  @Column({ nullable: true, select: false })
  tfaSecret: string;

  /**
   * 用户信息设置
   * JSON 格式存储的用户配置信息
   */
  @Column({ type: 'text', nullable: true })
  info: string;

  /**
   * 第三方认证类型
   * 如 oidc, ldap 等
   */
  @Column({ nullable: true })
  thirdAuthType: string;

  /**
   * 用户的令牌列表
   * 一对多关系，关联到 UserToken
   */
  @OneToMany(() => UserToken, (token) => token.user, { cascade: true })
  tokens: UserToken[];

  /**
   * 创建时间
   */
  @CreateDateColumn()
  createdAt: Date;

  /**
   * 更新时间
   */
  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * 获取解析后的 UserInfo
   */
  getUserInfo(): UserInfo {
    if (!this.info) {
      return {
        email_verification: false,
        email_alarm_notification: false,
        other: {},
      };
    }
    try {
      return JSON.parse(this.info) as UserInfo;
    } catch {
      return {
        email_verification: false,
        email_alarm_notification: false,
        other: {},
      };
    }
  }

  /**
   * 设置 UserInfo
   */
  setUserInfo(info: UserInfo): void {
    this.info = JSON.stringify(info);
  }
}
