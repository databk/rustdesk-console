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
 * 用户设备组权限实体
 * 管理用户对设备组的访问权限
 * 使用复合主键 (deviceGroupGuid, userGuid)
 */
@Entity('device_group_user_permissions')
export class DeviceGroupUserPermission {
  /**
   * 设备组GUID
   * 关联到 device_groups 表的 guid 字段
   */
  @PrimaryColumn()
  @Index()
  deviceGroupGuid: string;

  /**
   * 用户唯一标识符
   * 关联到 users 表的 guid 字段
   */
  @PrimaryColumn()
  @Index()
  userGuid: string;

  /**
   * 关联的设备组实体
   * 多对一关系，关联到 DeviceGroup
   */
  @ManyToOne(() => DeviceGroup, (permission) => permission.userPermissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'deviceGroupGuid' })
  deviceGroup: DeviceGroup;

  /**
   * 关联的用户实体
   * 多对一关系，关联到 User
   */
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userGuid' })
  user: User;

  /**
   * 创建时间
   */
  @CreateDateColumn()
  createdAt: Date;
}
