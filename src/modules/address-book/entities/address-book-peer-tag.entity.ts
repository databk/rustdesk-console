import { Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

/**
 * 地址簿节点标签关联实体
 * 管理设备与标签的多对多关系
 * 一个设备可以有多个标签，一个标签也可以对应多个设备
 */
@Entity('address_book_peer_tags')
export class AddressBookPeerTag {
  /**
   * 设备唯一标识符
   * 关联到 address_book_peers 表的 guid 字段
   */
  @PrimaryColumn()
  peerGuid: string;

  /**
   * 标签唯一标识符
   * 关联到 address_book_tags 表的 guid 字段
   */
  @PrimaryColumn()
  tagGuid: string;

  /**
   * 创建时间
   */
  @CreateDateColumn()
  createdAt: Date;
}
