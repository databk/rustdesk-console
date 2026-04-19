import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { HeartbeatModule } from './modules/heartbeat/heartbeat.module';
import { AddressBookModule } from './modules/address-book/address-book.module';
import { AuditModule } from './modules/audit/audit.module';
import { UserModule } from './modules/user/user.module';
import { DeviceGroupModule } from './modules/device-group/device-group.module';
import { AuthModule } from './modules/auth/auth.module';
import { OidcModule } from './modules/oidc/oidc.module';
import { SysinfoModule } from './modules/sysinfo/sysinfo.module';
import { DatabaseModule } from './database/database.module';
import { Sysinfo, Peer } from './common/entities';
import { ConnectionAudit } from './modules/audit/entities/connection-audit.entity';
import { FileAudit } from './modules/audit/entities/file-audit.entity';
import { AlarmAudit } from './modules/audit/entities/alarm-audit.entity';
import { AddressBook } from './modules/address-book/entities/address-book.entity';
import { AddressBookPeer } from './modules/address-book/entities/address-book-peer.entity';
import { AddressBookTag } from './modules/address-book/entities/address-book-tag.entity';
import { AddressBookPeerTag } from './modules/address-book/entities/address-book-peer-tag.entity';
import { AddressBookRule } from './modules/address-book/entities/address-book-rule.entity';
import { User } from './modules/user/entities/user.entity';
import { UserToken } from './modules/user/entities/user-token.entity';
import { OidcProvider } from './modules/oidc/entities/oidc-provider.entity';
import { OidcAuthState } from './modules/oidc/entities/oidc-auth-state.entity';
import { DeviceGroup } from './modules/device-group/entities/device-group.entity';
import { DeviceGroupUserPermission } from './modules/device-group/entities/device-group-user-permission.entity';
import { UserUserPermission } from './modules/device-group/entities/user-user-permission.entity';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { EmailVerificationSession } from './modules/auth/entities/email-verification-session.entity';

/**
 * 应用根模块
 * RustDesk API的根模块，负责配置全局依赖和导入所有功能模块
 *
 * 导入模块：
 * - ThrottlerModule - 请求限流模块
 * - TypeOrmModule - 数据库ORM模块
 * - DatabaseModule - 数据库初始化模块
 * - HeartbeatModule - 心跳模块
 * - AddressBookModule - 地址簿模块
 * - AuditModule - 审计模块
 * - UserModule - 用户模块
 * - DeviceGroupModule - 设备组模块
 * - AuthModule - 认证模块
 * - OidcModule - OIDC认证模块
 * - SysinfoModule - 系统信息模块
 *
 * 提供服务：
 * - ThrottlerGuard - 全局限流守卫
 * - JwtAuthGuard - 全局JWT认证守卫
 */
@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 100,
      },
    ]),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'rustdesk.db',
      entities: [
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
      ],
      synchronize: true,
      logging: false,
    }),
    DatabaseModule,
    HeartbeatModule,
    AddressBookModule,
    AuditModule,
    UserModule,
    DeviceGroupModule,
    AuthModule,
    OidcModule,
    SysinfoModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
