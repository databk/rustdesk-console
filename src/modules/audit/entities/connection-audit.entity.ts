import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('connection_audits')
export class ConnectionAudit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  deviceId: string;

  @Column({ type: 'text' })
  deviceUuid: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  connId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sessionId: string | null;

  @Column({ type: 'varchar', length: 45 })
  ip: string;

  @Column({ type: 'varchar', length: 10 })
  action: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  peerId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  peerName: string | null;

  @Column({ type: 'int', nullable: true })
  type: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  requestedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  establishedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  closedAt: Date | null;
}
