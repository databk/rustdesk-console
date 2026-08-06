import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemSetting } from '../settings/entities/system-setting.entity';
import { User } from '../user/entities/user.entity';
import { UserToken } from '../user/entities/user-token.entity';
import { Invitation } from '../user/entities/invitation.entity';
import { Peer } from '../../common/entities/peer.entity';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import { DeviceGroupUserPermission } from '../device-group/entities/device-group-user-permission.entity';
import { ConnectionAudit } from '../audit/entities/connection-audit.entity';
import { FileAudit } from '../audit/entities/file-audit.entity';
import { AlarmAudit } from '../audit/entities/alarm-audit.entity';
import { AddressBook } from '../address-book/entities/address-book.entity';
import { AddressBookPeer } from '../address-book/entities/address-book-peer.entity';
import { AddressBookTag } from '../address-book/entities/address-book-tag.entity';
import { AddressBookRule } from '../address-book/entities/address-book-rule.entity';
import { Strategy } from '../strategy/entities/strategy.entity';
import { UserGroup } from '../user-group/entities/user-group.entity';
import { PasskeyCredential } from '../auth/entities/passkey-credential.entity';
import { OidcProvider } from '../oidc/entities/oidc-provider.entity';
import { NexusBuild } from '../nexus/entities/nexus-build.entity';
import { NexusToken } from '../nexus/entities/nexus-token.entity';
import { ActiveConnection } from '../heartbeat/entities/active-connection.entity';
import { UpdateCheckController } from './update-check.controller';
import { UpdateCheckService } from './update-check.service';

/**
 * 更新检查模块
 * 提供版本更新检查、前端版本上报、更新通道管理功能
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SystemSetting,
      User,
      UserToken,
      Invitation,
      Peer,
      DeviceGroup,
      DeviceGroupUserPermission,
      ConnectionAudit,
      FileAudit,
      AlarmAudit,
      AddressBook,
      AddressBookPeer,
      AddressBookTag,
      AddressBookRule,
      Strategy,
      UserGroup,
      PasskeyCredential,
      OidcProvider,
      NexusBuild,
      NexusToken,
      ActiveConnection,
    ]),
  ],
  controllers: [UpdateCheckController],
  providers: [UpdateCheckService],
  exports: [UpdateCheckService],
})
export class UpdateCheckModule {}
