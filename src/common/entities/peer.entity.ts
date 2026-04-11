import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';

/**
 * 设备实体
 * 管理所有注册设备的基本信息
 */
@Entity('peers')
export class Peer {
  /**
   * 设备唯一标识符
   * UUID格式，用于唯一标识一个设备
   */
  @PrimaryColumn()
  uuid: string;

  /**
   * 设备ID
   * RustDesk 客户端的数字标识
   */
  @Column()
  id: string;

  /**
   * 所属用户唯一标识符
   * 关联到 users 表的 guid 字段
   */
  @Column({ nullable: true })
  @Index()
  userGuid: string;

  /**
   * 所属设备组GUID
   * 关联到 device_groups 表的 guid 字段
   */
  @Column({ nullable: true })
  @Index()
  deviceGroupGuid: string;

  /**
   * 关联的设备组实体
   * 多对一关系，关联到 DeviceGroup
   * 使用字符串引用避免循环依赖
   */
  @ManyToOne('DeviceGroup', 'peers', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'deviceGroupGuid' })
  deviceGroup: any;

  /**
   * 版本号
   * 设备信息的版本号
   */
  @Column()
  ver: number;

  /**
   * 修改时间戳
   * 设备信息最后修改的时间戳
   */
  @Column()
  modifiedAt: number;

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
