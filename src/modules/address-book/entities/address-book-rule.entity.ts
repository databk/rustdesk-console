import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AddressBook } from './address-book.entity';
import { UserGroup } from '../../user-group/entities/user-group.entity';

/**
 * Share permission rule enum
 * Defines the permission levels for address book sharing
 */
export enum ShareRule {
  /** Read-only permission - can only view address book contents */
  READ = 1,
  /** Read-write permission - can view and edit address book contents */
  READ_WRITE = 2,
  /** Full control permission - can view, edit, delete, and share the address book */
  FULL_CONTROL = 3,
}

/**
 * Address book rule entity
 * Manages access permission rules for address books
 *
 * Rule types:
 * - user: rule for a specific user
 * - group: rule for a specific group
 * - everyone: rule for all users (both user and group are empty)
 *
 * Permission levels:
 * - 1: Read (read-only)
 * - 2: ReadWrite (read-write)
 * - 3: FullControl (full control)
 */
@Entity('address_book_rules')
export class AddressBookRule {
  /**
   * Unique rule identifier
   * UUID format, uniquely identifies a rule
   */
  @PrimaryColumn()
  guid: string;

  /**
   * GUID of the owning address book
   * References the guid column of the address_books table
   */
  @PrimaryColumn()
  addressBookGuid: string;

  /**
   * Target user GUID
   * When the rule type is 'user', this field is the target user ID
   * When the rule type is 'group' or 'everyone', this field is empty
   */
  @Column({ type: 'varchar', nullable: true })
  @Index()
  targetUserId: string | null;

  /**
   * Target group GUID
   * When the rule type is 'group', this field is the target group ID
   * When the rule type is 'user' or 'everyone', this field is empty
   */
  @Column({ type: 'varchar', nullable: true })
  @Index()
  targetGroupId: string | null;

  @ManyToOne(() => UserGroup, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'targetGroupId' })
  targetGroup: UserGroup | null;

  /**
   * Rule permission level
   * 1: Read (read-only)
   * 2: ReadWrite (read-write)
   * 3: FullControl (full control)
   */
  @Column({ type: 'int', default: 1 })
  rule: number;

  /**
   * Associated address book
   */
  @ManyToOne(() => AddressBook, (addressBook) => addressBook.rules, {
    onDelete: 'CASCADE',
  })
  addressBook: AddressBook;

  /**
   * Creation time
   */
  @CreateDateColumn()
  createdAt: Date;

  /**
   * Update time
   */
  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * Get the rule type
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
