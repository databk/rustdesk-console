import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

/**
 * Active connection entity
 * Stores the currently active connections reported by client heartbeats
 */
@Entity('active_connections')
export class ActiveConnection {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * Connection ID
   * Unique connection identifier reported by the client
   */
  @Column({ type: 'integer' })
  @Index()
  connId: number;

  /**
   * Device UUID
   * Linked to the uuid field of the peers table
   */
  @Column({ type: 'varchar', length: 255 })
  @Index()
  deviceUuid: string;

  /**
   * Associated device entity
   */
  @ManyToOne('Peer', undefined, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceUuid' })
  device: any;

  @CreateDateColumn()
  createdAt: Date;
}
