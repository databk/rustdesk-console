import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Role } from './role.entity';

/**
 * 用户-角色映射实体
 * 复合主键 (userGuid, roleGuid)，一个用户可拥有多个角色，权限取并集
 */
@Entity('user_roles')
export class UserRole {
  /** 用户 GUID */
  @PrimaryColumn()
  @Index()
  userGuid: string;

  /** 角色 GUID */
  @PrimaryColumn()
  @Index()
  roleGuid: string;

  @ManyToOne(() => Role, (role) => role.userRoles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roleGuid' })
  role: Role;

  @CreateDateColumn()
  createdAt: Date;
}
