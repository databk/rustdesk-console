import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('sysinfos')
export class Sysinfo {
  @PrimaryColumn()
  uuid: string;

  @Column({ nullable: true })
  hostname: string;

  @Column({ nullable: true })
  username: string;

  @Column({ nullable: true })
  os: string;

  @Column({ nullable: true })
  cpu: string;

  @Column({ nullable: true })
  memory: string;

  @Column({ name: 'preset_username', nullable: true })
  presetUsername: string;

  @Column({ name: 'preset_strategy_name', nullable: true })
  presetStrategyName: string;

  @Column({ name: 'preset_device_group_name', nullable: true })
  presetDeviceGroupName: string;

  @Column({ name: 'preset_note', nullable: true })
  presetNote: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
