import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { AddressBook } from './address-book.entity';
import { AddressBookTag } from './address-book-tag.entity';

/**
 * Address book peer (device) entity
 * Manages all device peers in the address book
 */
@Entity('address_book_peers')
export class AddressBookPeer {
  /**
   * Unique device identifier
   * UUID format, uniquely identifies a device entry in the address book
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
  @ManyToOne(() => AddressBook, (addressBook) => addressBook.peers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'addressBookGuid' })
  addressBook: AddressBook;

  /**
   * Device ID
   * Unique identifier of the RustDesk client, usually numeric
   * Used to join the sysinfos table for device details
   */
  @Column()
  deviceId: string;

  /**
   * Connection hash
   * Secure hash used to verify the connection
   */
  @Column({ type: 'text', nullable: true })
  hash: string;

  /**
   * Connection password
   * Connection password of the device (stored encrypted)
   */
  @Column({ type: 'text', nullable: true })
  password: string;

  /**
   * Device alias
   * User-defined display name of the device
   */
  @Column({ nullable: true })
  alias: string;

  /**
   * Remarks
   * Detailed description or remarks for the device
   */
  @Column({ type: 'text', nullable: true })
  note: string;

  /**
   * List of tags associated with the device
   * Many-to-many relationship, linked through the address_book_peer_tags join table
   * A device can have multiple tags, and a tag can map to multiple devices
   */
  @ManyToMany(() => AddressBookTag, (tag) => tag.peers)
  @JoinTable({
    name: 'address_book_peer_tags',
    joinColumn: { name: 'peerGuid', referencedColumnName: 'guid' },
    inverseJoinColumn: { name: 'tagGuid', referencedColumnName: 'guid' },
  })
  tags: AddressBookTag[];

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
