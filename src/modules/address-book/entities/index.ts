/**
 * 地址簿实体模块
 * 导出所有地址簿相关的实体类和枚举
 */

/** 地址簿实体 - 管理所有地址簿信息 */
export { AddressBook } from './address-book.entity';

/** 地址簿节点实体 - 管理地址簿中的所有设备节点 */
export { AddressBookPeer } from './address-book-peer.entity';

/** 地址簿标签实体 - 管理地址簿中的所有标签 */
export { AddressBookTag } from './address-book-tag.entity';

/** 地址簿节点标签关联实体 - 管理设备与标签的多对多关系 */
export { AddressBookPeerTag } from './address-book-peer-tag.entity';

/** 地址簿规则实体 - 管理地址簿的访问规则和权限 */
export { AddressBookRule } from './address-book-rule.entity';

/** 共享权限规则枚举 - 定义地址簿共享的权限级别 */
export { ShareRule } from './address-book-rule.entity';
