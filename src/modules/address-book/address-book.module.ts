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

/**
 * 地址簿模块
 * 负责地址簿管理、设备管理、标签管理和规则管理
 *
 * 导入模块：
 * - TypeOrmModule
 *
 * 导出服务：
 * - AddressBookService
 *
 * 提供服务：
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
    ]),
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
