import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AddressBookPeer } from './address-book-peer.entity';
import { AddressBookTag } from './address-book-tag.entity';

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
  @Index('IDX_1fa1cb6f8a11c6688a83c5da0f')
  peerGuid: string;

  @ManyToOne(() => AddressBookPeer, (peer) => peer.tagLinks, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'peerGuid' })
  peer: AddressBookPeer;

  /**
   * Unique tag identifier
   * References the guid column of the address_book_tags table
   */
  @PrimaryColumn()
  @Index('IDX_a55915fc46903ac9da334ac14e')
  tagGuid: string;

  @ManyToOne(() => AddressBookTag, (tag) => tag.peerLinks)
  @JoinColumn({ name: 'tagGuid' })
  tag: AddressBookTag;

  /**
   * Creation time
   */
  @CreateDateColumn()
  createdAt: Date;
}
