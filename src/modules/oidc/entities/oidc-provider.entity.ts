import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * OIDC 提供商实体
 * 管理 OpenID Connect 身份提供商配置
 */
@Entity('oidc_providers')
export class OidcProvider {
  /**
   * 提供商唯一标识符
   * UUID格式，用于唯一标识一个 OIDC 提供商
   */
  @PrimaryColumn()
  guid: string;

  /**
   * 提供商名称
   * 用于显示和区分不同的提供商
   */
  @Column()
  @Index()
  name: string;

  /**
   * 发行者 URL
   * OIDC 提供商的发行者标识
   */
  @Column()
  issuer: string;

  /**
   * 客户端 ID
   * 在 OIDC 提供商注册的应用标识
   */
  @Column()
  clientId: string;

  /**
   * 客户端密钥
   * 在 OIDC 提供商注册的应用密钥
   */
  @Column({ nullable: true, select: false })
  clientSecret: string;

  /**
   * 授权范围
   * 请求的 OAuth2 授权范围
   */
  @Column({ nullable: true })
  scope: string;

  /**
   * 授权端点
   * OIDC 提供商的授权端点 URL
   */
  @Column({ nullable: true })
  authorizationEndpoint: string;

  /**
   * 令牌端点
   * OIDC 提供商的令牌端点 URL
   */
  @Column({ nullable: true })
  tokenEndpoint: string;

  /**
   * 用户信息端点
   * OIDC 提供商的用户信息端点 URL
   */
  @Column({ nullable: true })
  userinfoEndpoint: string;

  /**
   * 是否启用
   * true - 提供商可用
   * false - 提供商禁用
   */
  @Column({ default: true })
  enabled: boolean;

  /**
   * 显示优先级
   * 数值越小优先级越高
   */
  @Column({ default: 0 })
  priority: number;

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
