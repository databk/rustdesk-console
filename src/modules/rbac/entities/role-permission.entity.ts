import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Role } from './role.entity';
import { Permission } from './permission.entity';

/**
 * 角色-权限映射实体
 * 复合主键 (roleGuid, permissionGuid)
 */
@Entity('role_permissions')
export class RolePermission {
  /** 角色 GUID */
  @PrimaryColumn()
  @Index()
  roleGuid: string;

  /** 权限 GUID */
  @PrimaryColumn()
  @Index()
  permissionGuid: string;

  @ManyToOne(() => Role, (role) => role.rolePermissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'roleGuid' })
  role: Role;

  @ManyToOne(() => Permission, (permission) => permission.rolePermissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'permissionGuid' })
  permission: Permission;

  @CreateDateColumn()
  createdAt: Date;
}
