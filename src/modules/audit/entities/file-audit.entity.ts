import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// SQLite 不支持 ENUM，所以使用整数代替
// 对于支持 ENUM 的数据库，可以在装饰器中使用 @Column({ type: 'enum', enum: FileAuditType })

export const FileAuditType = {
  SEND: 0,
  RECEIVE: 1,
} as const;

export type FileAuditType = typeof FileAuditType[keyof typeof FileAuditType];

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

  @Column({ type: 'int' }) // SQLite 使用 int，其他数据库可以用 enum
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
}
