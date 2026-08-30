import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Role } from './role.entity';
import { UserRoleAssignmentDeviceGroup } from './user-role-assignment-device-group.entity';

export type AssignmentScopeType = 'global' | 'device_group';

@Entity('user_role_assignments')
@Index(['userGuid', 'roleGuid'], { unique: true })
export class UserRoleAssignment {
  @PrimaryColumn()
  guid: string;

  @Column({ type: 'varchar' })
  @Index()
  userGuid: string;

  @Column({ type: 'varchar' })
  @Index()
  roleGuid: string;

  @Column({ type: 'varchar' })
  scopeType: AssignmentScopeType;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userGuid', referencedColumnName: 'guid' })
  user: User;

  @ManyToOne(() => Role, (role) => role.assignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roleGuid', referencedColumnName: 'guid' })
  role: Role;

  @OneToMany(() => UserRoleAssignmentDeviceGroup, (group) => group.assignment)
  deviceGroups: UserRoleAssignmentDeviceGroup[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
