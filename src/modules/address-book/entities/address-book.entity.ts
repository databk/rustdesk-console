import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { AddressBookPeer } from './address-book-peer.entity';
import { AddressBookTag } from './address-book-tag.entity';
import { AddressBookRule } from './address-book-rule.entity';

/**
 * 地址簿实体
 * 管理所有地址簿信息
 */
@Entity('address_books')
export class AddressBook {
  /**
   * 地址簿唯一标识符
   * UUID格式，用于唯一标识一个地址簿
   */
  @PrimaryColumn()
  guid: string;

  /**
   * 所有者用户ID
   * 标识该地址簿属于哪个用户
   */
  @Column()
  owner: string;

  /**
   * 是否为个人地址簿
   * true - 个人地址簿（每个用户默认有一个）
   * false - 自定义地址簿
   */
  @Column({ default: false })
  isPersonal: boolean;

  /**
   * 地址簿名称
   * 用于显示和区分不同的地址簿
   */
  @Column({ nullable: true })
  name: string;

  /**
   * 备注
   * 地址簿的详细说明信息
   */
  @Column({ type: 'text', nullable: true })
  note: string;

  /**
   * 扩展信息
   * JSON格式的额外配置信息，用于存储自定义设置
   */
  @Column({ type: 'text', nullable: true })
  info: string;

  /**
   * 地址簿中的设备列表
   * 一对多关系，关联到 AddressBookPeer
   */
  @OneToMany(() => AddressBookPeer, peer => peer.addressBook, { cascade: true })
  peers: AddressBookPeer[];

  /**
   * 地址簿中的标签列表
   * 一对多关系，关联到 AddressBookTag
   */
  @OneToMany(() => AddressBookTag, tag => tag.addressBook, { cascade: true })
  tags: AddressBookTag[];

  /**
   * 地址簿的规则列表
   * 一对多关系，关联到 AddressBookRule
   */
  @OneToMany(() => AddressBookRule, rule => rule.addressBook, { cascade: true })
  rules: AddressBookRule[];

  /**
   * 创建时间
   */
  @CreateDateColumn()
  createdAt: Date;

  /**
   * 更新时间
   */
  @UpdateDateColumn()
  updatedAt: Date;
}
