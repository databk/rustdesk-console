import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RolePermission } from './role-permission.entity';
import { UserRoleAssignment } from './user-role-assignment.entity';

@Entity('roles')
export class Role {
  @PrimaryColumn()
  guid: string;

  @Column({ type: 'varchar', unique: true, collation: 'NOCASE' })
  @Index()
  name: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @OneToMany(() => RolePermission, (permission) => permission.role)
  rolePermissions: RolePermission[];

  @OneToMany(() => UserRoleAssignment, (assignment) => assignment.role)
  assignments: UserRoleAssignment[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
