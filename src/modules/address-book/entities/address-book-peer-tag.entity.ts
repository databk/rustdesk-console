import { Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

/**
 * Address book peer-tag association entity
 * Manages the many-to-many relationship between devices and tags
 * A device can have multiple tags, and a tag can map to multiple devices
 */
@Entity('address_book_peer_tags')
export class AddressBookPeerTag {
  /**
   * Unique device identifier
   * References the guid column of the address_book_peers table
   */
  @PrimaryColumn()
  peerGuid: string;

  /**
   * Unique tag identifier
   * References the guid column of the address_book_tags table
   */
  @PrimaryColumn()
  tagGuid: string;

  /**
   * Creation time
   */
  @CreateDateColumn()
  createdAt: Date;
}
