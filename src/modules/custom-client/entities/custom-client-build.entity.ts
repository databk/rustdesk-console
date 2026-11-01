import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type CustomClientBuildStatus =
  'pending' | 'building' | 'completed' | 'failed';

@Entity('custom_client_builds')
export class CustomClientBuild {
  @PrimaryColumn()
  uuid: string;

  @Column()
  @Index('IDX_custom_client_builds_userGuid', ['userGuid'])
  userGuid: string;

  @Column()
  os: string;

  @Column()
  arch: string;

  @Column({ type: 'text', nullable: true })
  custom: string;

  @Column({ default: 'pending' })
  @Index('IDX_custom_client_builds_status', ['status'])
  status: CustomClientBuildStatus;

  @Column({ nullable: true })
  message: string;

  @Column({ type: 'text', nullable: true })
  files: string;

  @Column()
  callbackToken: string;

  @Column({ nullable: true })
  githubRunId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
