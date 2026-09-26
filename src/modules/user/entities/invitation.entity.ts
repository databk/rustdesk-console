import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Invitation entity
 * Records user invitation information, including the invitation token, expiration time, etc.
 */
@Entity('invitations')
export class Invitation {
  /**
   * Unique invitation identifier
   */
  @PrimaryColumn()
  guid: string;

  /**
   * Invitation token
   * Unique identifier for the invitation link, a cryptographically secure random string
   */
  @Column({ unique: true })
  token: string;

  /**
   * Invitee email
   */
  @Column()
  email: string;

  /**
   * Invitee username
   */
  @Column()
  name: string;

  /**
   * Invitee display name
   */
  @Column({ type: 'varchar', nullable: true })
  displayName: string | null;

  /**
   * Associated user group GUID
   */
  @Column({ type: 'varchar', nullable: true })
  userGroupGuid: string | null;

  /**
   * Note
   */
  @Column({ type: 'varchar', nullable: true })
  note: string | null;

  /**
   * Associated user GUID
   * Linked to the corresponding user after the invitation is accepted
   */
  @Column({ type: 'varchar', nullable: true })
  userGuid: string | null;

  /**
   * Invitation expiration time
   */
  @Column()
  expiresAt: Date;

  /**
   * Invitation usage time
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
