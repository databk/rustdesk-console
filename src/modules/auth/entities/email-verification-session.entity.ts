import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 登录验证会话实体
 * 管理登录二次验证（邮箱验证码 / TFA）的临时会话
 *
 * 安全说明：
 * secret 字段是服务端生成的 UUID 会话标识符，仅用于跟踪一次登录，
 * 绝不是 TFA 密钥本身。TFA 密钥始终保留在服务端，不会返回给客户端。
 */
@Entity('email_verification_sessions')
export class EmailVerificationSession {
  /**
   * 会话唯一标识符
   * UUID格式，用于唯一标识一个验证会话
   */
  @PrimaryColumn()
  guid: string;

  /**
   * 会话密钥
   * 服务端生成的 UUID，用于关联两次登录请求（发起验证 / 提交验证码）
   * 注意：此字段不是 TFA 密钥，仅为一次性会话标识符
   */
  @Column({ unique: true })
  @Index()
  secret: string;

  /**
   * 所属用户唯一标识符
   * 关联到 users 表的 guid 字段
   */
  @Column()
  @Index()
  userGuid: string;

  /**
   * 验证方式
   * 'email' - 邮箱验证码登录
   * 'tfa' - 双因素认证登录
   */
  @Column({ default: 'email' })
  method: 'email' | 'tfa';

  /**
   * 邮箱地址
   * 待验证的邮箱地址（仅邮箱验证方式使用，TFA 方式可空）
   */
  @Column({ nullable: true })
  email?: string;

  /**
   * 验证码
   * 发送到邮箱的验证码（仅邮箱验证方式使用，TFA 方式可空）
   */
  @Column({ nullable: true })
  code?: string;

  /**
   * 过期时间
   * 验证会话的过期时间
   */
  @Column({ type: 'datetime' })
  expiresAt: Date;

  /**
   * 是否已使用
   * true - 验证码已使用
   * false - 验证码未使用
   */
  @Column({ default: false })
  used: boolean;

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
}
