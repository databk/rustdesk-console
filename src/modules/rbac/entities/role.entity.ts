import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { RolePermission } from './role-permission.entity';
import { UserRole } from './user-role.entity';

/**
 * 角色实体
 * 管理角色定义，内置角色（isBuiltIn=true）不可删除
 */
@Entity('roles')
export class Role {
  /** 角色唯一标识符，UUID */
  @PrimaryColumn()
  guid: string;

  /** 显示名称，唯一 */
  @Column({ unique: true })
  @Index()
  name: string;

  /** 机器可读代码，唯一（如 admin/operator/viewer），创建后不可改 */
  @Column({ unique: true })
  @Index()
  code: string;

  /** 角色描述 */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 是否为内置角色，内置角色不可删除 */
  @Column({ default: false })
  isBuiltIn: boolean;

  @OneToMany(() => RolePermission, (rp) => rp.role, { cascade: true })
  rolePermissions: RolePermission[];

  @OneToMany(() => UserRole, (ur) => ur.role, { cascade: true })
  userRoles: UserRole[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
