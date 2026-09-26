/**
 * Address book entity module
 * Exports all address book related entity classes and enums
 */

/** Address book entity - manages all address book information */
export { AddressBook } from './address-book.entity';

/** Address book peer entity - manages all device peers in the address book */
export { AddressBookPeer } from './address-book-peer.entity';

/** Address book tag entity - manages all tags in the address book */
export { AddressBookTag } from './address-book-tag.entity';

/** Address book peer-tag association entity - manages the many-to-many relationship between devices and tags */
export { AddressBookPeerTag } from './address-book-peer-tag.entity';

/** Address book rule entity - manages address book access rules and permissions */
export { AddressBookRule } from './address-book-rule.entity';

/** Share permission rule enum - defines the permission levels for address book sharing */
export { ShareRule } from './address-book-rule.entity';
