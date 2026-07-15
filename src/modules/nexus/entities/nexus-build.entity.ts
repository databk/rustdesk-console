import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type BuildStatus =
  | 'pending'
  | 'building'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Nexus 构建记录实体
 * 持久化每次客户端定制构建的状态与配置
 */
@Entity('nexus_builds')
export class NexusBuild {
  /** Nexus 构建任务 UUID */
  @PrimaryColumn()
  @Index()
  uuid: string;

  /** 关联的本地用户 GUID */
  @Column()
  @Index()
  userGuid: string;

  /** 操作系统 */
  @Column()
  os: string;

  /** 架构 */
  @Column()
  arch: string;

  /** 应用名称 */
  @Column()
  appName: string;

  /** 定制配置 JSON */
  @Column({ type: 'text', nullable: true })
  custom: string;

  /** 构建状态 */
  @Column({ default: 'pending' })
  status: BuildStatus;

  /** 构建产物文件列表 JSON */
  @Column({ type: 'text', nullable: true })
  files: string;

  /** 状态补充说明 */
  @Column({ nullable: true })
  message: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
