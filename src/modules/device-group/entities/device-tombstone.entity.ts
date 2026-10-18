import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * Tombstone for a deleted device.
 *
 * Deleting a peer used to be reversible by a single heartbeat: the heartbeat
 * handler recreated unknown devices on sight. A tombstone marks the device as
 * deliberately removed so heartbeats no longer resurrect it; restoring the
 * tombstone re-admits the device.
 */
@Entity('device_tombstones')
@Index('IDX_device_tombstones_deviceId', ['deviceId'])
export class DeviceTombstone {
  /** Device UUID (same identifier as Peer.uuid) */
  @PrimaryColumn()
  uuid: string;

  /** Last known RustDesk device id at deletion time */
  @Column()
  deviceId: string;

  /** Whether the device id was also banned at the hbbs admission layer */
  @Column({ default: false })
  banned: boolean;

  /** Actor that deleted the device */
  @Column({ type: 'varchar', nullable: true })
  deletedBy: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
