import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ServerRole = 'hbbs' | 'hbbr';
export type ServerStatus = 'online' | 'offline' | 'degraded';

@Entity('server_nodes')
@Index(['role'])
export class ServerNode {
  @PrimaryColumn()
  guid: string;

  @Column({ type: 'varchar' })
  role: ServerRole;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar', select: false })
  url: string;

  @Column({ type: 'varchar', select: false })
  managementToken: string;

  @Column({ type: 'varchar', default: 'offline' })
  status: ServerStatus;

  @Column({ type: 'datetime', nullable: true })
  lastCheckedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}