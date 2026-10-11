import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('server_ban_policies')
export class ServerBanPolicy {
  @PrimaryColumn()
  id: number;

  @Column({ type: 'text', default: '[]' })
  deviceIds: string;

  @Column({ type: 'text', default: '[]' })
  ips: string;

  @UpdateDateColumn()
  updatedAt: Date;
}