import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, Index } from 'typeorm';
import { DeviceGroupUserPermission } from './device-group-user-permission.entity';

/**
 * 设备组实体
 * 管理设备分组信息
 */
@Entity('device_groups')
export class DeviceGroup {
  /**
   * 设备组唯一标识符
   * UUID格式，用于唯一标识一个设备组
   */
  @PrimaryColumn()
  guid: string;

  /**
   * 设备组名称
   * 用于显示和区分不同的设备组
   */
  @Column({ unique: true })
  @Index()
  name: string;

  /**
   * 备注
   * 设备组的详细说明信息
   */
  @Column({ type: 'text', nullable: true })
  note: string;

  /**
   * 设备组的用户权限列表
   * 一对多关系，关联到 DeviceGroupUserPermission
   */
  @OneToMany(() => DeviceGroupUserPermission, permission => permission.deviceGroup, { cascade: true })
  userPermissions: DeviceGroupUserPermission[];

  /**
   * 设备组中的设备列表
   * 一对多关系，关联到 Peer
   */
  @OneToMany('Peer', 'deviceGroup', { cascade: true })
  peers: any[];

  /**
   * 创建时间
   */
  @CreateDateColumn()
  createdAt: Date;

  /**
   * 更新时间
   */
  @UpdateDateColumn()
  updatedAt: Date;
}
