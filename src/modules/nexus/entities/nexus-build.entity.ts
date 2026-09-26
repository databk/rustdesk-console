import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type BuildStatus =
  'pending' | 'building' | 'completed' | 'failed' | 'cancelled';

/**
 * Nexus build record entity
 * Persists the status and configuration of every custom client build
 */
@Entity('nexus_builds')
export class NexusBuild {
  /** Nexus build task UUID */
  @PrimaryColumn()
  @Index()
  uuid: string;

  /** Associated local user GUID */
  @Column()
  @Index()
  userGuid: string;

  /** Operating system */
  @Column()
  os: string;

  /** Architecture */
  @Column()
  arch: string;

  /** App name */
  @Column()
  appName: string;

  /** Customization configuration JSON */
  @Column({ type: 'text', nullable: true })
  custom: string;

  /** Build status */
  @Column({ default: 'pending' })
  status: BuildStatus;

  /** Build artifact file list JSON */
  @Column({ type: 'text', nullable: true })
  files: string;

  /** Additional status details */
  @Column({ nullable: true })
  message: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
