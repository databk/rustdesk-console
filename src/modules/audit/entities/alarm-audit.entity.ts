import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

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
}
