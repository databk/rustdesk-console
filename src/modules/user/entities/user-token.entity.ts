import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * 用户令牌实体
 * 管理用户的登录令牌
 */
@Entity('user_tokens')
export class UserToken {
  /**
   * 令牌唯一标识符
   * UUID格式，用于唯一标识一个令牌
   */
  @PrimaryColumn()
  guid: string;

  /**
   * 所属用户唯一标识符
   * 关联到 users 表的 guid 字段
   */
  @Column()
  @Index()
  userGuid: string;

  /**
   * JWT 令牌
   * 用于身份验证的令牌字符串
   */
  @Column()
  @Index()
  token: string;

  /**
   * 设备ID
   * RustDesk 客户端的设备标识
   */
  @Column({ nullable: true })
  deviceId: string;

  /**
   * 设备UUID
   * 设备的唯一标识符
   */
  @Column({ nullable: true })
  deviceUuid: string;

  /**
   * 过期时间
   * 令牌的过期时间
   */
  @Column({ type: 'datetime' })
  expiresAt: Date;

  /**
   * 是否已撤销
   * true - 令牌已失效
   * false - 令牌有效
   */
  @Column({ default: false })
  isRevoked: boolean;

  /**
   * 关联的用户实体
   * 多对一关系，关联到 User
   */
  @ManyToOne(() => User, (user) => user.tokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userGuid' })
  user: User;

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
