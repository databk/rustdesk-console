import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { AddressBookPeer } from './address-book-peer.entity';
import { AddressBookTag } from './address-book-tag.entity';
import { AddressBookRule } from './address-book-rule.entity';

/**
 * Address book entity
 * Manages all address book information
 */
@Entity('address_books')
export class AddressBook {
  /**
   * Unique address book identifier
   * UUID format, uniquely identifies an address book
   */
  @PrimaryColumn()
  guid: string;

  /**
   * Owner user ID
   * Identifies which user the address book belongs to
   */
  @Column()
  owner: string;

  /**
   * Whether this is a personal address book
   * true - personal address book (each user has one by default)
   * false - custom address book
   */
  @Column({ default: false })
  isPersonal: boolean;

  /** Whether this non-personal address book is managed as a shared resource. */
  @Column({ default: false })
  isShared: boolean;

  /**
   * Address book name
   * Used to display and distinguish different address books
   */
  @Column({ nullable: true })
  name: string;

  /**
   * Remarks
   * Detailed description of the address book
   */
  @Column({ type: 'text', nullable: true })
  note: string;

  /**
   * Extended information
   * Additional configuration in JSON format, used to store custom settings
   */
  @Column({ type: 'text', nullable: true })
  info: string;

  /**
   * List of devices in the address book
   * One-to-many relationship, references AddressBookPeer
   */
  @OneToMany(() => AddressBookPeer, (peer) => peer.addressBook, {
    cascade: true,
  })
  peers: AddressBookPeer[];

  /**
   * List of tags in the address book
   * One-to-many relationship, references AddressBookTag
   */
  @OneToMany(() => AddressBookTag, (tag) => tag.addressBook, { cascade: true })
  tags: AddressBookTag[];

  /**
   * List of rules of the address book
   * One-to-many relationship, references AddressBookRule
   */
  @OneToMany(() => AddressBookRule, (rule) => rule.addressBook, {
    cascade: true,
  })
  rules: AddressBookRule[];

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
}
