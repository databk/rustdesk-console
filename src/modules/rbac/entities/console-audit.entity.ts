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

  @CreateDateColumn()
  createdAt: Date;
}
