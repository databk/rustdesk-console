import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * OIDC 授权状态枚举
 */
export enum OidcAuthStatus {
  PENDING = 'pending',      // 等待用户授权
  AUTHORIZED = 'authorized', // 已授权
  EXPIRED = 'expired',      // 已过期
  CANCELLED = 'cancelled',  // 已取消
}

/**
 * OIDC 授权状态实体
 * 管理 OIDC 授权流程的临时状态
 */
@Entity('oidc_auth_states')
export class OidcAuthState {
  /**
   * 授权状态唯一标识符
   * UUID格式，用于唯一标识一个授权状态
   */
  @PrimaryColumn()
  guid: string;

  /**
   * 授权码
   * 用于轮询查询的授权码
   */
  @Column()
  @Index()
  code: string;

  /**
   * OIDC 提供商标识
   * 如 oidc/google
   */
  @Column()
  @Index()
  op: string;

  /**
   * 设备ID
   * RustDesk 客户端的设备标识
   */
  @Column()
  deviceId: string;

  /**
   * 设备UUID
   * 设备的唯一标识符
   */
  @Column()
  deviceUuid: string;

  /**
   * 设备信息
   * JSON 格式的设备详细信息
   */
  @Column({ type: 'text', nullable: true })
  deviceInfo: string;

  /**
   * 重定向 URI
   * OIDC 回调地址
   */
  @Column({ type: 'text', nullable: true })
  redirectUri: string;

  /**
   * OIDC state 参数
   * 用于防止 CSRF 攻击
   */
  @Column({ type: 'text', nullable: true })
  state: string;

  /**
   * 授权状态
   * pending - 等待授权
   * authorized - 已授权
   * expired - 已过期
   * cancelled - 已取消
   */
  @Column({
    type: 'text',
    default: OidcAuthStatus.PENDING,
  })
  status: OidcAuthStatus;

  /**
   * 用户唯一标识符
   * 授权成功后关联的用户
   */
  @Column({ nullable: true })
  userGuid: string;

  /**
   * 访问令牌
   * 系统生成的 JWT 令牌
   */
  @Column({ nullable: true })
  accessToken: string;

  /**
   * OIDC 访问令牌
   * OIDC 提供商返回的 access_token
   */
  @Column({ type: 'text', nullable: true })
  oidcAccessToken: string;

  /**
   * OIDC 刷新令牌
   * OIDC 提供商返回的 refresh_token
   */
  @Column({ type: 'text', nullable: true })
  oidcRefreshToken: string;

  /**
   * 过期时间
   * 授权码的过期时间（默认3分钟）
   */
  @Column({ type: 'datetime' })
  expiresAt: Date;

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
