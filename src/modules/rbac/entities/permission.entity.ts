import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { RolePermission } from './role-permission.entity';

/**
 * 权限实体
 * 权限目录，由代码常量启动时 upsert，禁止通过 API 增删
 */
@Entity('permissions')
export class Permission {
  /** 权限唯一标识符，UUID */
  @PrimaryColumn()
  guid: string;

  /** 权限码，`模块:动作` 形式（如 user:write），唯一 */
  @Column({ unique: true })
  @Index()
  code: string;

  /** 显示名称 */
  @Column()
  name: string;

  /** 所属模块（如 user、device-group） */
  @Column()
  @Index()
  module: string;

  /** 权限描述 */
  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => RolePermission, (rp) => rp.permission)
  rolePermissions: RolePermission[];
}
