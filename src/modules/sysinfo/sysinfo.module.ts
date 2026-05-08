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
import { DeviceThrottlerGuard } from '../../common/guards/device-throttler.guard';

/**
 * 系统信息模块
 * 负责设备系统信息的收集和管理
 *
 * 导入模块：
 * - TypeOrmModule
 *
 * 导出服务：
 * - SysinfoService
 *
 * 提供服务：
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
  providers: [
    SysinfoService,
  ],
  exports: [SysinfoService],
})
export class SysinfoModule {}
