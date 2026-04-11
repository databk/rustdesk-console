import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { AddressBook } from './address-book.entity';

/**
 * 共享权限规则枚举
 * 定义地址簿共享的权限级别
 */
export enum ShareRule {
  /** 只读权限 - 只能查看地址簿内容 */
  READ = 1,
  /** 读写权限 - 可以查看和编辑地址簿内容 */
  READ_WRITE = 2,
  /** 完全控制权限 - 可以查看、编辑、删除和共享地址簿 */
  FULL_CONTROL = 3,
}

/**
 * 地址簿规则实体
 * 管理地址簿的访问权限规则
 * 
 * 规则类型:
 * - user: 针对特定用户的规则
 * - group: 针对特定组的规则
 * - everyone: 针对所有用户的规则（user 和 group 都为空）
 * 
 * 权限级别:
 * - 1: Read (只读)
 * - 2: ReadWrite (读写)
 * - 3: FullControl (完全控制)
 */
@Entity('address_book_rules')
export class AddressBookRule {
  /**
   * 规则唯一标识符
   * UUID 格式，用于唯一标识一个规则
   */
  @PrimaryColumn()
  guid: string;

  /**
   * 所属地址簿 GUID
   * 关联到 address_books 表的 guid 字段
   */
  @PrimaryColumn()
  addressBookGuid: string;

  /**
   * 目标用户 GUID
   * 当规则类型为 'user' 时，此字段为目标用户 ID
   * 当规则类型为 'group' 或 'everyone' 时，此字段为空
   */
  @Column({ type: 'varchar', nullable: true })
  targetUserId: string;

  /**
   * 目标组 GUID
   * 当规则类型为 'group' 时，此字段为目标组 ID
   * 当规则类型为 'user' 或 'everyone' 时，此字段为空
   */
  @Column({ type: 'varchar', nullable: true })
  targetGroupId: string;

  /**
   * 规则权限级别
   * 1: Read (只读)
   * 2: ReadWrite (读写)
   * 3: FullControl (完全控制)
   */
  @Column({ type: 'int', default: 1 })
  rule: number;

  /**
   * 关联的地址簿
   */
  @ManyToOne(() => AddressBook, (addressBook) => addressBook.rules, {
    onDelete: 'CASCADE',
  })
  addressBook: AddressBook;

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

  /**
   * 获取规则类型
   * @returns "user" | "group" | "everyone"
   */
  get ruleType(): 'user' | 'group' | 'everyone' {
    if (this.targetUserId) {
      return 'user';
    }
    if (this.targetGroupId) {
      return 'group';
    }
    return 'everyone';
  }
}
