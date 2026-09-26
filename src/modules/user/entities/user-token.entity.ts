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
 * User token entity
 * Manages user login tokens
 */
@Entity('user_tokens')
export class UserToken {
  /**
   * Unique token identifier
   * UUID format, uniquely identifies a token
   */
  @PrimaryColumn()
  guid: string;

  /**
   * Unique identifier of the owning user
   * References the guid field of the users table
   */
  @Column()
  @Index()
  userGuid: string;

  /**
   * JWT ID (JTI)
   * Unique identifier used for token revocation checks; the full JWT is not stored
   */
  @Column({ length: 36 })
  @Index()
  jti: string;

  /**
   * device ID
   * Device identifier of the RustDesk client
   */
  @Column({ nullable: true })
  deviceId: string;

  /**
   * Device UUID
   * Unique identifier of the device
   */
  @Column({ nullable: true })
  deviceUuid: string;

  /**
   * Expiration time
   * Expiration time of the token
   */
  @Column({ type: 'datetime' })
  expiresAt: Date;

  /**
   * Whether revoked
   * true - token is no longer valid
   * false - token is valid
   */
  @Column({ default: false })
  isRevoked: boolean;

  /**
   * Device operating system
   * Submitted by the client at login, e.g. linux, windows, android
   */
  @Column({ type: 'varchar', nullable: true })
  deviceOs: string;

  /**
   * Device source type
   * "client" means the RustDesk client, "browser" means a browser
   */
  @Column({ type: 'varchar', nullable: true })
  deviceType: string;

  /**
   * Device name
   * For clients, taken from the hostname; for browsers, from navigator.userAgent
   */
  @Column({ type: 'varchar', nullable: true })
  deviceName: string;

  /**
   * Associated user entity
   * Many-to-one relation to User
   */
  @ManyToOne(() => User, (user) => user.tokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userGuid' })
  user: User;

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
