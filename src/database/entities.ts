import { Sysinfo, Peer } from '../common/entities';
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
import { Role } from '../modules/rbac/entities/role.entity';
import { RolePermission } from '../modules/rbac/entities/role-permission.entity';
import { UserRoleAssignment } from '../modules/rbac/entities/user-role-assignment.entity';
import { UserRoleAssignmentDeviceGroup } from '../modules/rbac/entities/user-role-assignment-device-group.entity';
import { ConsoleAudit } from '../modules/rbac/entities/console-audit.entity';

// Keep the runtime and migration CLI on the same entity set.
export const DATABASE_ENTITIES = [
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
  Role,
  RolePermission,
  UserRoleAssignment,
  UserRoleAssignmentDeviceGroup,
  ConsoleAudit,
];
