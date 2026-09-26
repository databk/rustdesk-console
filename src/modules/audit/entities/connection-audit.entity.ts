import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Connection type enum
 */
export enum ConnType {
  NOT_ESTABLISHED = -1,
  REMOTE_CONTROL = 0,
  FILE_TRANSFER = 1,
  PORT_FORWARD = 2,
  CAMERA = 3,
  TERMINAL = 4,
}

/**
 * Primary authentication method enum
 */
export enum PrimaryAuth {
  NONE = 0,
  CLICK = 1,
  TEMPORARY_PASSWORD = 2,
  PERMANENT_PASSWORD = 3,
  SWITCH_SIDES = 4,
}

/**
 * Two-factor authentication method enum
 */
export enum TwoFactor {
  NONE = 0,
  TOTP = 1,
  TRUSTED_DEVICE = 2,
}

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

  @Column({ type: 'int', default: ConnType.NOT_ESTABLISHED })
  type: number;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  requestedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  establishedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  @Index({ unique: true })
  nonce: string | null;

  @Column({ type: 'text', nullable: true })
  connAuditRef: string | null;

  @Column({ type: 'int', nullable: true })
  primaryAuth: number | null;

  @Column({ type: 'int', nullable: true })
  twoFactor: number | null;
}
