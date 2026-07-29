/**
 * 集中实体列表
 * 统一管理所有 TypeORM 实体，供 app.module.ts 和 data-source.ts 共享
 * 避免两处维护不同的实体列表导致不同步
 */
import { Sysinfo } from '../common/entities/sysinfo.entity';
import { Peer } from '../common/entities/peer.entity';
import { ConnectionAudit } from '../modules/audit/entities/connection-audit.entity';
import { FileAudit } from '../modules/audit/entities/file-audit.entity';
import { AlarmAudit } from '../modules/audit/entities/alarm-audit.entity';
import { AddressBook } from '../modules/address-book/entities/address-book.entity';
import { AddressBookPeer } from '../modules/address-book/entities/address-book-peer.entity';
import { AddressBookTag } from '../modules/address-book/entities/address-book-tag.entity';
import { AddressBookPeerTag } from '../modules/address-book/entities/address-book-peer-tag.entity';
import { AddressBookRule } from '../modules/address-book/entities/address-book-rule.entity';
import { User } from '../modules/user/entities/user.entity';
import { UserToken } from '../modules/user/entities/user-token.entity';
import { Invitation } from '../modules/user/entities/invitation.entity';
import { OidcProvider } from '../modules/oidc/entities/oidc-provider.entity';
import { OidcAuthState } from '../modules/oidc/entities/oidc-auth-state.entity';
import { DeviceGroup } from '../modules/device-group/entities/device-group.entity';
import { DeviceGroupUserPermission } from '../modules/device-group/entities/device-group-user-permission.entity';
import { UserUserPermission } from '../modules/device-group/entities/user-user-permission.entity';
import { LoginSession } from '../modules/auth/entities/login-session.entity';
import { PasskeyCredential } from '../modules/auth/entities/passkey-credential.entity';
import { SystemSetting } from '../modules/settings/entities/system-setting.entity';
import { ActiveConnection } from '../modules/heartbeat/entities/active-connection.entity';
import { Strategy } from '../modules/strategy/entities/strategy.entity';
import { NexusToken } from '../modules/nexus/entities/nexus-token.entity';
import { NexusBuild } from '../modules/nexus/entities/nexus-build.entity';
import { UserGroup } from '../modules/user-group/entities/user-group.entity';

export const ALL_ENTITIES = [
  Sysinfo,
  Peer,
  ConnectionAudit,
  FileAudit,
  AlarmAudit,
  AddressBook,
  AddressBookPeer,
  AddressBookTag,
  AddressBookPeerTag,
  AddressBookRule,
  User,
  UserToken,
  Invitation,
  OidcProvider,
  OidcAuthState,
  DeviceGroup,
  DeviceGroupUserPermission,
  UserUserPermission,
  LoginSession,
  PasskeyCredential,
  SystemSetting,
  ActiveConnection,
  Strategy,
  NexusToken,
  NexusBuild,
  UserGroup,
];
