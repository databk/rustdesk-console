import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Nexus token entity
 * Stores the association between a user and the GitHub OAuth token of the Nexus system
 */
@Entity('nexus_tokens')
export class NexusToken {
  /** Associated local user GUID */
  @PrimaryColumn()
  @Index()
  userGuid: string;

  /** Nexus JWT Token */
  @Column({ type: 'text' })
  nexusToken: string;

  /** GitHub username */
  @Column()
  nexusUsername: string;

  /** Token expiration time */
  @Column({ type: 'datetime' })
  expiresAt: Date;

  /** Current build task UUID (if any) */
  @Column({ nullable: true })
  currentUuid: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Check whether the token has expired */
  isExpired(): boolean {
    return new Date() > this.expiresAt;
  }
}
