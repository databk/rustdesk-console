import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SysinfoController } from './sysinfo.controller';
import { SysinfoService } from './sysinfo.service';
import { Sysinfo, Peer } from '../../common/entities';
import {
  AddressBook,
  AddressBookPeer,
  AddressBookTag,
} from '../address-book/entities';
import { DeviceGroup } from '../device-group/entities/device-group.entity';

/**
 * System info module
 * Responsible for collecting and managing device system information
 *
 * Imported modules:
 * - TypeOrmModule
 *
 * Exported services:
 * - SysinfoService
 *
 * Provided services:
 * - SysinfoService
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Sysinfo,
      AddressBook,
      AddressBookPeer,
      AddressBookTag,
      DeviceGroup,
      Peer,
    ]),
  ],
  controllers: [SysinfoController],
  providers: [SysinfoService],
  exports: [SysinfoService],
})
export class SysinfoModule {}
