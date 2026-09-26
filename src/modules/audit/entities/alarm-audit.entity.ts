import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Alarm type enum
 */
export enum AlarmType {
  IP_WHITELIST = 0,
  EXCEED_THIRTY_ATTEMPTS = 1,
  SIX_ATTEMPTS_WITHIN_ONE_MINUTE = 2,
  EXCEED_IPV6_PREFIX_ATTEMPTS = 6,
  TERMINAL_OS_LOGIN_BACKOFF = 7,
  TERMINAL_OS_LOGIN_CONCURRENCY = 8,
  SESSION_SCOPE_VIOLATION = 9,
  ID_WHITELIST = 10,
}

@Entity('alarm_audits')
export class AlarmAudit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  deviceId: string;

  @Column({ type: 'text' })
  deviceUuid: string;

  @Column({ type: 'int' })
  typ: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  infoId: string | null;

  @Column({ type: 'varchar', length: 45 })
  infoIp: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  infoName: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  connId: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  @Index({ unique: true })
  nonce: string | null;

  @Column({ type: 'text', nullable: true })
  connAuditRef: string | null;
}
