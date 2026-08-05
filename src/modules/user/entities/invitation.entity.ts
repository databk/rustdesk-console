import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 邀请实体
 * 记录用户邀请信息，包括邀请令牌、过期时间等
 */
@Entity('invitations')
export class Invitation {
  /**
   * 邀请唯一标识符
   */
  @PrimaryColumn()
  guid: string;

  /**
   * 邀请令牌
   * 用于邀请链接的唯一标识，使用加密安全的随机字符串
   */
  @Column({ unique: true })
  token: string;

  /**
   * 被邀请者邮箱
   */
  @Column()
  email: string;

  /**
   * 被邀请者用户名
   */
  @Column()
  name: string;

  /**
   * 被邀请者显示名称
   */
  @Column({ type: 'varchar', nullable: true })
  displayName: string | null;

  /**
   * 关联的用户组 GUID
   */
  @Column({ type: 'varchar', nullable: true })
  userGroupGuid: string | null;

  /**
   * 备注
   */
  @Column({ type: 'varchar', nullable: true })
  note: string | null;

  /**
   * 关联的用户 GUID
   * 邀请被接受后关联到对应用户
   */
  @Column({ type: 'varchar', nullable: true })
  userGuid: string | null;

  /**
   * 邀请过期时间
   */
  @Column()
  expiresAt: Date;

  /**
   * 邀请使用时间
   * 为 null 表示尚未使用
   */
  @Column({ type: 'datetime', nullable: true })
  usedAt: Date | null;

  /**
   * 创建时间
   */
  @CreateDateColumn()
  createdAt: Date;

  /**
   * 更新时间
   */
  @UpdateDateColumn()
  updatedAt: Date;
}
