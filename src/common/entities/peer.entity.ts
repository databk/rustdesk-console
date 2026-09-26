import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Strategy } from '../../modules/strategy/entities/strategy.entity';

/**
 * Device status enum
 * 1: Normal
 * 0: Disabled
 */
export enum PeerStatus {
  DISABLED = 0,
  ACTIVE = 1,
}

/**
 * Device entity
 * Manages basic information of all registered devices
 */
@Entity('peers')
export class Peer {
  /**
   * Unique device identifier
   * UUID format, uniquely identifies a device
   */
  @PrimaryColumn()
  uuid: string;

  /**
   * device ID
   * Numeric identifier of the RustDesk client
   */
  @Column()
  id: string;

  /**
   * Unique identifier of the owning user
   * References the guid field of the users table
   */
  @Column({ type: 'varchar', nullable: true })
  @Index()
  userGuid: string | null;

  /**
   * GUID of the owning device group
   * References the guid field of the device_groups table
   */
  @Column({ type: 'varchar', nullable: true })
  @Index()
  deviceGroupGuid: string | null;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  strategyGuid: string | null;

  /**
   * Device note
   * Note added to the device by an administrator
   */
  @Column({ type: 'varchar', nullable: true })
  note: string | null;

  @ManyToOne('Strategy', () => Strategy, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'strategyGuid' })
  strategy: any;

  @ManyToOne('DeviceGroup', 'peers', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'deviceGroupGuid' })
  deviceGroup: any;

  /**
   * Device status
   * 1: Normal, 0: Disabled
   */
  @Column({
    type: 'integer',
    default: PeerStatus.ACTIVE,
  })
  status: PeerStatus;

  /**
   * Version number
   * Version number of the device information
   */
  @Column()
  ver: number;

  /**
   * Modification timestamp
   * Timestamp of the last modification of the device information
   */
  @Column()
  modifiedAt: number;

  /**
   * Creation time
   */
  @CreateDateColumn()
  createdAt: Date;

  /**
   * Last heartbeat time
   * Time the device last sent a heartbeat, used to determine online status
   */
  @Column({ type: 'datetime', nullable: true })
  lastHeartbeat: Date | null;

  /**
   * Update time
   */
  @UpdateDateColumn()
  updatedAt: Date;
}
