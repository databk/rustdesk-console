import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 邮箱验证会话实体
 * 管理邮箱验证的临时会话
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
   * 用于关联验证请求的唯一密钥
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
   * 邮箱地址
   * 待验证的邮箱地址
   */
  @Column()
  email: string;

  /**
   * 验证码
   * 发送到邮箱的验证码
   */
  @Column()
  code: string;

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
