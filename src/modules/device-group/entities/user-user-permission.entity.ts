import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';

/**
 * 用户间权限实体
 * 管理用户对其他用户设备的访问权限
 * 使用复合主键 (userGuid, targetUserGuid)
 */
@Entity('user_user_permissions')
export class UserUserPermission {
  /**
   * 授权用户唯一标识符
   * 拥有访问权限的用户
   */
  @PrimaryColumn()
  @Index()
  userGuid: string;

  /**
   * 目标用户唯一标识符
   * 被授权访问的用户（其设备可被访问）
   */
  @PrimaryColumn()
  @Index()
  targetUserGuid: string;

  /**
   * 关联的授权用户实体
   * 多对一关系，关联到 User
   */
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userGuid' })
  user: User;

  /**
   * 关联的目标用户实体
   * 多对一关系，关联到 User
   */
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'targetUserGuid' })
  targetUser: User;

  /**
   * 创建时间
   */
  @CreateDateColumn()
  createdAt: Date;
}
