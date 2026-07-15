import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Nexus Token 实体
 * 存储用户与 Nexus 系统的 GitHub OAuth Token 关联
 */
@Entity('nexus_tokens')
export class NexusToken {
  /** 关联的本地用户 GUID */
  @PrimaryColumn()
  @Index()
  userGuid: string;

  /** Nexus JWT Token */
  @Column({ type: 'text' })
  nexusToken: string;

  /** GitHub 用户名 */
  @Column()
  nexusUsername: string;

  /** Token 过期时间 */
  @Column({ type: 'datetime' })
  expiresAt: Date;

  /** 当前构建任务 UUID（如有） */
  @Column({ nullable: true })
  currentUuid: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** 检查 Token 是否已过期 */
  isExpired(): boolean {
    return new Date() > this.expiresAt;
  }
}
