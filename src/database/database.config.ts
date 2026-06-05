import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
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
import { OidcProvider } from '../modules/oidc/entities/oidc-provider.entity';
import { OidcAuthState } from '../modules/oidc/entities/oidc-auth-state.entity';
import { DeviceGroup } from '../modules/device-group/entities/device-group.entity';
import { DeviceGroupUserPermission } from '../modules/device-group/entities/device-group-user-permission.entity';
import { UserUserPermission } from '../modules/device-group/entities/user-user-permission.entity';
import { EmailVerificationSession } from '../modules/auth/entities/email-verification-session.entity';
import { SystemSetting } from '../modules/settings/entities/system-setting.entity';
import { ActiveConnection } from '../modules/heartbeat/entities/active-connection.entity';
import { Strategy } from '../modules/strategy/entities/strategy.entity';

const entities = [
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
  OidcProvider,
  OidcAuthState,
  DeviceGroup,
  DeviceGroupUserPermission,
  UserUserPermission,
  EmailVerificationSession,
  SystemSetting,
  ActiveConnection,
  Strategy,
];

export const getDatabaseConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => {
  const dbType = configService.get<string>('DB_TYPE', 'sqlite');

  if (dbType === 'mysql') {
    return {
      type: 'mysql',
      host: configService.get<string>('DB_HOST', 'localhost'),
      port: configService.get<number>('DB_PORT', 3306),
      username: configService.get<string>('DB_USERNAME', 'root'),
      password: configService.get<string>('DB_PASSWORD', ''),
      database: configService.get<string>('DB_DATABASE', 'rustdesk'),
      entities,
      synchronize:
        configService.get<string>('DB_SYNCHRONIZE', 'true') === 'true',
      logging: configService.get<string>('DB_LOGGING', 'false') === 'true',
      charset: 'utf8mb4',
    };
  }

  // Default: SQLite
  return {
    type: 'sqlite',
    database: configService.get<string>('DB_DATABASE', 'rustdesk.db'),
    entities,
    synchronize: true,
    logging: false,
  };
};

// For TypeORM CLI migrations
export default new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'rustdesk',
  entities,
  migrations: ['src/database/migrations/*.ts'],
});
