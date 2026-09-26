import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * OIDC provider entity
 * Manages OpenID Connect identity provider configuration
 */
export enum OidcProviderType {
  OIDC = 'oidc',
  OAUTH2 = 'oauth2',
}

@Entity('oidc_providers')
export class OidcProvider {
  /**
   * Unique provider identifier
   * UUID format, uniquely identifies an OIDC provider
   */
  @PrimaryColumn()
  guid: string;

  /**
   * Provider name
   * Used to display and distinguish different providers
   */
  @Column()
  @Index()
  name: string;

  @Column({
    type: 'text',
    default: OidcProviderType.OIDC,
  })
  type: OidcProviderType;

  /**
   * Issuer URL
   * Issuer identifier of the OIDC provider
   */
  @Column()
  issuer: string;

  /**
   * Client ID
   * Application identifier registered with the OIDC provider
   */
  @Column()
  clientId: string;

  /**
   * Client secret
   * Application secret registered with the OIDC provider
   */
  @Column({ nullable: true, select: false })
  clientSecret: string;

  /**
   * Authorization scope
   * Requested OAuth2 authorization scope
   */
  @Column({ nullable: true })
  scope: string;

  /**
   * Authorization endpoint
   * Authorization endpoint URL of the OIDC provider
   */
  @Column({ nullable: true })
  authorizationEndpoint: string;

  /**
   * Token endpoint
   * Token endpoint URL of the OIDC provider
   */
  @Column({ nullable: true })
  tokenEndpoint: string;

  /**
   * User info endpoint
   * User info endpoint URL of the OIDC provider
   */
  @Column({ nullable: true })
  userinfoEndpoint: string;

  /**
   * JWKS endpoint
   * JSON Web Key Set endpoint URL of the OIDC provider, used to verify ID Token signatures
   */
  @Column({ nullable: true })
  jwksUri: string;

  /**
   * Provider icon
   * SVG icon string of a custom OIDC provider, shown in the client
   * Null for built-in providers; the client uses its built-in SVG
   */
  @Column({ type: 'text', nullable: true })
  icon: string;

  /**
   * Whether enabled
   * true - provider is available
   * false - provider is disabled
   */
  @Column({ default: true })
  enabled: boolean;

  /**
   * Display priority
   * Lower value means higher priority
   */
  @Column({ default: 0 })
  priority: number;

  /**
   * Creation time
   */
  @CreateDateColumn()
  createdAt: Date;

  /**
   * Update time
   */
  @UpdateDateColumn()
  updatedAt: Date;
}
