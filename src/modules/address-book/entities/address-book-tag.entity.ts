import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, ManyToMany } from 'typeorm';
import { AddressBook } from './address-book.entity';
import { AddressBookPeer } from './address-book-peer.entity';

/**
 * 地址簿标签实体
 * 管理地址簿中的所有标签
 */
@Entity('address_book_tags')
export class AddressBookTag {
  /**
   * 标签唯一标识符
   * UUID格式，用于唯一标识一个标签
   */
  @PrimaryColumn()
  guid: string;

  /**
   * 所属地址簿唯一标识符
   * 关联到 address_books 表的 guid 字段
   */
  @Column()
  addressBookGuid: string;

  /**
   * 关联的地址簿实体
   * 多对一关系，关联到 AddressBook
   */
  @ManyToOne(() => AddressBook, addressBook => addressBook.tags, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'addressBookGuid' })
  addressBook: AddressBook;

  /**
   * 标签名称
   * 用于显示和区分不同的标签
   * 在同一地址簿内标签名不能重复
   */
  @Column()
  name: string;

  /**
   * 标签颜色
   * 十六进制颜色值，用于前端显示
   * 例如: 0xFF5733 表示红色
   */
  @Column({ type: 'bigint', default: 0 })
  color: number;

  /**
   * 标签关联的设备列表
   * 多对多关系，通过 address_book_peer_tags 中间表关联
   * 一个标签可以对应多个设备，一个设备也可以有多个标签
   */
  @ManyToMany(() => AddressBookPeer, peer => peer.tags)
  peers: AddressBookPeer[];

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
