import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { DeviceGroupUserPermission } from './device-group-user-permission.entity';
import { Strategy } from '../../strategy/entities/strategy.entity';

/**
 * Device group entity
 * Manages device grouping information
 */
@Entity('device_groups')
export class DeviceGroup {
  /**
   * Device group unique identifier
   * UUID format, used to uniquely identify a device group
   */
  @PrimaryColumn()
  guid: string;

  /**
   * Device group name
   * Used to display and distinguish different device groups
   */
  @Column()
  @Index({ unique: true })
  name: string;

  /**
   * Remarks
   * Detailed description of the device group
   */
  @Column({ type: 'text', nullable: true })
  note: string;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  strategyGuid: string | null;

  @ManyToOne('Strategy', () => Strategy, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'strategyGuid' })
  strategy: any;

  @OneToMany(
    () => DeviceGroupUserPermission,
    (permission) => permission.deviceGroup,
    { cascade: true },
  )
  userPermissions: DeviceGroupUserPermission[];

  /**
   * List of devices in the device group
   * One-to-many relation to Peer
   */
  @OneToMany('Peer', 'deviceGroup', { cascade: true })
  peers: any[];

  /**
   * Creation time
   */
  @CreateDateColumn()
  createdAt: Date;

  /**
   * Update time
   */
  @UpdateDateColumn()
  updatedAt: Date;
}
