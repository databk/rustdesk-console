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

  @Column({ name: 'preset_address_book_name', nullable: true })
  presetAddressBookName: string;

  @Column({ name: 'preset_address_book_tag', nullable: true })
  presetAddressBookTag: string;

  @Column({ name: 'preset_address_book_alias', nullable: true })
  presetAddressBookAlias: string;

  @Column({ name: 'preset_address_book_password', nullable: true })
  presetAddressBookPassword: string;

  @Column({ name: 'preset_address_book_note', nullable: true })
  presetAddressBookNote: string;

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
