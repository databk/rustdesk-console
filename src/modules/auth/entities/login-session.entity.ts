import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 登录会话实体
 * 管理登录二次验证（邮箱验证码 / TFA）的临时会话
 *
 * 安全说明：
 * guid 字段同时作为数据库主键和返回给客户端的会话标识符，
 * 避免冗余的 secret 字段。客户端在二次验证时回传 guid（通过 secret 字段）。
 */
@Entity('login_sessions')
export class LoginSession {
  /**
   * 会话唯一标识符
   * UUID格式，同时作为数据库主键和客户端会话标识符
   */
  @PrimaryColumn()
  @Index()
  guid: string;

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
   * 'passkey_reg' - Passkey 注册（存储 challenge）
   * 'passkey' - Passkey 无密码登录（存储 challenge）
   * 'passkey_tfa' - Passkey 双因素认证登录（存储 challenge）
   */
  @Column({ default: 'email' })
  method: 'email' | 'tfa' | 'passkey_reg' | 'passkey' | 'passkey_tfa';

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
