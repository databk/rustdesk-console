import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { DeviceGroup } from './device-group.entity';
import { User } from '../../user/entities/user.entity';

/**
 * User device group permission entity
 * Manages a user's access permission to device groups
 * Uses a composite primary key (deviceGroupGuid, userGuid)
 */
@Entity('device_group_user_permissions')
export class DeviceGroupUserPermission {
  /**
   * Device group GUID
   * Refers to the guid column of the device_groups table
   */
  @PrimaryColumn()
  @Index()
  deviceGroupGuid: string;

  /**
   * User unique identifier
   * Refers to the guid column of the users table
   */
  @PrimaryColumn()
  @Index()
  userGuid: string;

  /**
   * Associated device group entity
   * Many-to-one relation to DeviceGroup
   */
  @ManyToOne(() => DeviceGroup, (permission) => permission.userPermissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'deviceGroupGuid' })
  deviceGroup: DeviceGroup;

  /**
   * Associated user entity
   * Many-to-one relation to User
   */
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userGuid' })
  user: User;

  /**
   * Creation time
   */
  @CreateDateColumn()
  createdAt: Date;
}
