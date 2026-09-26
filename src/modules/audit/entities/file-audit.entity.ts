import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

// SQLite does not support ENUM, so integers are used instead
// For databases that support ENUM, you can use @Column({ type: 'enum', enum: FileAuditType })

export const FileAuditType = {
  SEND: 0,
  RECEIVE: 1,
} as const;

export type FileAuditType = (typeof FileAuditType)[keyof typeof FileAuditType];

@Entity('file_audits')
export class FileAudit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  deviceId: string;

  @Column({ type: 'text' })
  deviceUuid: string;

  @Column({ type: 'varchar', length: 255 })
  peerId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  connId: string | null;

  @Column({ type: 'int' }) // SQLite uses int; other databases can use enum
  type: number;

  @Column({ type: 'text', nullable: true })
  path: string | null;

  @Column({ type: 'boolean' })
  isFile: boolean;

  @Column({ type: 'varchar', length: 45 })
  clientIp: string;

  @Column({ type: 'varchar', length: 255 })
  clientName: string;

  @Column({ type: 'int' })
  fileCount: number;

  @Column({ type: 'json' })
  files: Array<[string, number]>;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'varchar', length: 36, nullable: true })
  @Index({ unique: true })
  nonce: string | null;
}
