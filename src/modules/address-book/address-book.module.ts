import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressBookController } from './address-book.controller';
import {
  AddressBookService,
  AddressBookPeerService,
  AddressBookTagService,
  AddressBookLegacyService,
  AddressBookPermissionService,
  AddressBookRuleService,
} from './services';
import {
  AddressBook,
  AddressBookPeer,
  AddressBookTag,
  AddressBookPeerTag,
  AddressBookRule,
} from './entities';
import { Sysinfo, Peer } from '../../common/entities';
import { User } from '../user/entities/user.entity';
import { UserGroupModule } from '../user-group/user-group.module';
import { UserGroup } from '../user-group/entities/user-group.entity';

/**
 * Address book module
 * Handles address book management, device management, tag management, and rule management
 *
 * Imported modules:
 * - TypeOrmModule
 *
 * Exported services:
 * - AddressBookService
 *
 * Provided services:
 * - AddressBookService
 * - PeerService
 * - TagService
 * - ShareService
 * - LegacyService
 * - RuleService
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AddressBook,
      AddressBookPeer,
      AddressBookTag,
      AddressBookPeerTag,
      AddressBookRule,
      Sysinfo,
      Peer,
      User,
      UserGroup,
    ]),
    UserGroupModule,
  ],
  controllers: [AddressBookController],
  providers: [
    AddressBookService,
    AddressBookPeerService,
    AddressBookTagService,
    AddressBookLegacyService,
    AddressBookPermissionService,
    AddressBookRuleService,
  ],
  exports: [AddressBookService],
})
export class AddressBookModule {}
