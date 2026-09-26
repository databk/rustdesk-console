import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import type { IndexOptions } from 'typeorm';
import { UserToken } from './user-token.entity';
import { Strategy } from '../../strategy/entities/strategy.entity';
import { UserGroup } from '../../user-group/entities/user-group.entity';

/**
 * User status enum
 * -1: Email not verified
 * 0: Disabled
 * 1: Normal
 */
export enum UserStatus {
  UNVERIFIED = -1,
  DISABLED = 0,
  ACTIVE = 1,
}

/**
 * User info settings
 */
export interface UserInfo {
  email_verification?: boolean;
  email_alarm_notification?: boolean;
  other?: Record<string, any>;
}

/**
 * User entity
 * Manages all user information
 */
@Entity('users')
// DatabaseInitService creates this index after validating legacy owner rows.
// Registering it with synchronize=false prevents schema sync from dropping it.
@Index('UQ_users_single_owner', ['isAdmin'], {
  unique: true,
  where: '"isAdmin" = 1',
  synchronize: false,
} as IndexOptions & { synchronize: false })
export class User {
  /**
   * Unique user identifier
   * UUID format, uniquely identifies a user
   */
  @PrimaryColumn()
  guid: string;

  /**
   * Username
   * Unique identifier used for login
   */
  @Column()
  @Index({ unique: true })
  username: string;

  /**
   * Display name
   * Name shown to the user in the client, distinct from the login username
   */
  @Column({ type: 'varchar', nullable: true })
  displayName: string | null;

  /**
   * Email address
   * Used for email verification and notifications
   */
  @Column({ type: 'varchar', nullable: true })
  @Index({ unique: true })
  email: string | null;

  /**
   * Password
   * User password, stored encrypted
   */
  @Column({ select: false, nullable: true })
  password: string;

  /**
   * Note
   * Detailed description of the user
   */
  @Column({ nullable: true })
  note: string;

  /**
   * Authenticator
   * Two-factor authentication secret
   */
  @Column({ nullable: true, select: false })
  verifier: string;

  /**
   * User status
   * -1: Email not verified, 0: Disabled, 1: Normal
   */
  @Column({
    type: 'integer',
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  /**
   * Whether the user is an administrator
   * true - has administrator privileges
   * false - regular user
   */
  @Column({ default: false })
  isAdmin: boolean;

  /**
   * Email verification code
   * Temporary code used for email verification
   */
  @Column({ nullable: true, select: false })
  emailVerificationCode: string;

  /**
   * Two-factor authentication secret
   * Secret used for TOTP authentication
   */
  @Column({ nullable: true, select: false })
  tfaSecret: string;

  /**
   * User info settings
   * User configuration stored as JSON
   */
  @Column({ type: 'text', nullable: true })
  info: string;

  /**
   * Third-party authentication type
   * e.g. oidc, ldap
   */
  @Column({ nullable: true })
  thirdAuthType: string;

  /**
   * OIDC subject identifier
   * Format: oidc:{providerName}:{sub}
   * Used to link the user identity at the OIDC provider, preventing account takeover
   */
  @Column({ nullable: true })
  @Index({ unique: true })
  oidcSubject: string;

  @Column({ type: 'varchar', nullable: true })
  avatar: string | null;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  strategyGuid: string | null;

  @ManyToOne('Strategy', () => Strategy, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'strategyGuid' })
  strategy: any;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  userGroupGuid: string | null;

  @ManyToOne(() => UserGroup, (userGroup) => userGroup.users, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'userGroupGuid' })
  userGroup: UserGroup | null;

  @OneToMany(() => UserToken, (token) => token.user, { cascade: true })
  tokens: UserToken[];

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

  /**
   * Get the parsed UserInfo
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
   * Set UserInfo
   */
  setUserInfo(info: UserInfo): void {
    this.info = JSON.stringify(info);
  }
}
