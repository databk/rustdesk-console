import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';

export type CustomClientBuildStatus =
  | 'pending'
  | 'building'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'neutral'
  | 'action_required';

@Entity('custom_client_builds')
@Index('IDX_custom_client_builds_userGuid_createdAt', ['userGuid', 'createdAt'])
export class CustomClientBuild {
  @PrimaryColumn()
  uuid: string;

  @Column()
  userGuid: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userGuid' })
  user: User;

  @Column()
  os: string;

  @Column()
  arch: string;

  @Column({ type: 'text', nullable: true })
  custom: string;

  @Column({ default: 'pending' })
  @Index('IDX_custom_client_builds_status', ['status'])
  status: CustomClientBuildStatus;

  @Column({ type: 'text', nullable: true })
  files: string;

  @Column()
  buildToken: string;

  @Column({ type: 'bigint', nullable: true })
  githubRunId: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
