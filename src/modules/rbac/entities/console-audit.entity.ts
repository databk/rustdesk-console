import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('console_audits')
@Index(['actorUserGuid', 'createdAt'])
@Index(['targetType', 'targetGuid', 'createdAt'])
export class ConsoleAudit {
  @PrimaryColumn()
  guid: string;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  actorUserGuid: string | null;

  /**
   * Snapshot of the actor's username at the time of the operation.
   * Keeps audit rows readable even after the user is deleted.
   * Falls back to the joined `User.username` when null (legacy rows).
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  actorUsername: string | null;

  @Column({ type: 'varchar' })
  targetType: string;

  @Column({ type: 'varchar', nullable: true })
  targetGuid: string | null;

  @Column({ type: 'varchar' })
  action: string;

  @Column({ type: 'varchar' })
  result: 'allowed' | 'denied';

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'text', nullable: true })
  beforeState: string | null;

  @Column({ type: 'text', nullable: true })
  afterState: string | null;

  @Column({ type: 'varchar', nullable: true })
  requestId: string | null;

  /**
   * Originating client IP of the audited request, for source attribution.
   */
  @Column({ type: 'varchar', length: 45, nullable: true })
  @Index()
  ip: string | null;

  /**
   * Originating User-Agent of the audited request, truncated to 512 chars.
   */
  @Column({ type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
