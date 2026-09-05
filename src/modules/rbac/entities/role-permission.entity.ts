import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Role } from './role.entity';

@Entity('role_permissions')
@Index(['roleGuid', 'permissionCode'], { unique: true })
export class RolePermission {
  @PrimaryColumn()
  @Index()
  roleGuid: string;

  @PrimaryColumn({ type: 'varchar' })
  @Index()
  permissionCode: string;

  @ManyToOne(() => Role, (role) => role.rolePermissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'roleGuid', referencedColumnName: 'guid' })
  role: Role;
}
