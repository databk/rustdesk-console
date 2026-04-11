import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, ManyToMany, JoinTable } from 'typeorm';
import { AddressBook } from './address-book.entity';
import { AddressBookTag } from './address-book-tag.entity';

/**
 * 地址簿节点（设备）实体
 * 管理地址簿中的所有设备节点
 */
@Entity('address_book_peers')
export class AddressBookPeer {
  /**
   * 设备唯一标识符
   * UUID格式，用于唯一标识地址簿中的一个设备条目
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
  @ManyToOne(() => AddressBook, addressBook => addressBook.peers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'addressBookGuid' })
  addressBook: AddressBook;

  /**
   * 设备ID
   * RustDesk客户端的唯一标识，通常为数字格式
   * 用于关联 sysinfos 表获取设备详细信息
   */
  @Column()
  deviceId: string;

  /**
   * 连接哈希值
   * 用于验证连接的安全哈希值
   */
  @Column({ type: 'text', nullable: true })
  hash: string;

  /**
   * 连接密码
   * 设备的连接密码（加密存储）
   */
  @Column({ type: 'text', nullable: true })
  password: string;

  /**
   * 设备别名
   * 用户自定义的设备显示名称
   */
  @Column({ nullable: true })
  alias: string;

  /**
   * 备注信息
   * 设备的详细说明或备注
   */
  @Column({ type: 'text', nullable: true })
  note: string;

  /**
   * 设备关联的标签列表
   * 多对多关系，通过 address_book_peer_tags 中间表关联
   * 一个设备可以有多个标签，一个标签也可以对应多个设备
   */
  @ManyToMany(() => AddressBookTag, tag => tag.peers)
  @JoinTable({
    name: 'address_book_peer_tags',
    joinColumn: { name: 'peerGuid', referencedColumnName: 'guid' },
    inverseJoinColumn: { name: 'tagGuid', referencedColumnName: 'guid' },
  })
  tags: AddressBookTag[];

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
