import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Login session entity
 * Manages temporary sessions for second-step login verification (email verification code / TFA)
 *
 * Security note:
 * The guid field serves as both the database primary key and the session identifier returned to the client,
 * avoiding a redundant secret field. The client sends the guid back (via the secret field) during second-step verification.
 */
@Entity('login_sessions')
export class LoginSession {
  /**
   * Unique session identifier
   * UUID format; serves as both the database primary key and the client session identifier
   */
  @PrimaryColumn()
  @Index()
  guid: string;

  /**
   * Unique identifier of the owning user
   * References the guid field of the users table
   */
  @Column()
  @Index()
  userGuid: string;

  /**
   * Verification method
   * 'email' - email verification code login
   * 'tfa' - two-factor authentication login
   * 'passkey_reg' - Passkey registration (stores the challenge)
   * 'passkey' - Passkey passwordless login (stores the challenge)
   * 'passkey_tfa' - Passkey two-factor authentication login (stores the challenge)
   */
  @Column({ default: 'email' })
  method: 'email' | 'tfa' | 'passkey_reg' | 'passkey' | 'passkey_tfa';

  /**
   * Email address
   * Email address to verify (used only by the email verification method; nullable for TFA)
   */
  @Column({ nullable: true })
  email?: string;

  /**
   * Verification code
   * Verification code sent to the email (used only by the email verification method; nullable for TFA)
   */
  @Column({ nullable: true })
  code?: string;

  /**
   * Expiration time
   * Expiration time of the verification session
   */
  @Column({ type: 'datetime' })
  expiresAt: Date;

  /**
   * Whether it has been used
   * true - verification code has been used
   * false - verification code has not been used
   */
  @Column({ default: false })
  used: boolean;

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
