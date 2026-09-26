import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  ManyToMany,
} from 'typeorm';
import { AddressBook } from './address-book.entity';
import { AddressBookPeer } from './address-book-peer.entity';

/**
 * Address book tag entity
 * Manages all tags in the address book
 */
@Entity('address_book_tags')
export class AddressBookTag {
  /**
   * Unique tag identifier
   * UUID format, uniquely identifies a tag
   */
  @PrimaryColumn()
  guid: string;

  /**
   * Unique identifier of the owning address book
   * References the guid column of the address_books table
   */
  @Column()
  addressBookGuid: string;

  /**
   * Associated address book entity
   * Many-to-one relationship, references AddressBook
   */
  @ManyToOne(() => AddressBook, (addressBook) => addressBook.tags, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'addressBookGuid' })
  addressBook: AddressBook;

  /**
   * Tag name
   * Used to display and distinguish different tags
   * Tag names must be unique within the same address book
   */
  @Column()
  name: string;

  /**
   * Tag color
   * Hexadecimal color value, used for frontend display
   * e.g. 0xFF5733 represents red
   */
  @Column({ type: 'int', unsigned: true, default: 0 })
  color: number;

  /**
   * List of devices associated with the tag
   * Many-to-many relationship, linked through the address_book_peer_tags join table
   * A tag can map to multiple devices, and a device can have multiple tags
   */
  @ManyToMany(() => AddressBookPeer, (peer) => peer.tags)
  peers: AddressBookPeer[];

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
