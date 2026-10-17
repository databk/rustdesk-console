import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Password reset token entity
 * Records one-time password reset links, including the token, expiration time, etc.
 */
@Entity('password_reset_tokens')
export class PasswordResetToken {
  /**
   * Unique token record identifier
   */
  @PrimaryColumn()
  guid: string;

  /**
   * Reset token
   * Unique identifier for the reset link, a cryptographically secure random string
   */
  @Column({ unique: true })
  token: string;

  /**
   * Owning user GUID
   * References the guid field of the users table
   */
  @Column()
  @Index()
  userGuid: string;

  /**
   * Expiration time
   */
  @Column()
  expiresAt: Date;

  /**
   * Usage time
   * null means not yet used
   */
  @Column({ type: 'datetime', nullable: true })
  usedAt: Date | null;

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
