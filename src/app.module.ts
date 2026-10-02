import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DeviceThrottlerGuard } from './common/guards/device-throttler.guard';
import { HeartbeatModule } from './modules/heartbeat/heartbeat.module';
import { AddressBookModule } from './modules/address-book/address-book.module';
import { AuditModule } from './modules/audit/audit.module';
import { UserModule } from './modules/user/user.module';
import { DeviceGroupModule } from './modules/device-group/device-group.module';
import { AuthModule } from './modules/auth/auth.module';
import { OidcModule } from './modules/oidc/oidc.module';
import { SysinfoModule } from './modules/sysinfo/sysinfo.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DatabaseModule } from './database/database.module';
import { DataSource } from 'typeorm';
import { createDataSourceOptions } from './database/data-source-options';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { SettingsModule } from './modules/settings/settings.module';
import { LdapModule } from './modules/ldap/ldap.module';
import { StrategyModule } from './modules/strategy/strategy.module';
import { UpdateCheckModule } from './modules/update-check/update-check.module';
import { NexusModule } from './modules/nexus/nexus.module';
import { UserGroupModule } from './modules/user-group/user-group.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { RbacGuard } from './modules/rbac/guards/rbac.guard';
import { ConsoleAuditInterceptor } from './modules/rbac/interceptors/console-audit.interceptor';

/**
 * Application root module
 * Root module of the RustDesk API; configures global dependencies and imports all feature modules
 *
 * Imported modules:
 * - ThrottlerModule - request throttling module
 * - TypeOrmModule - database ORM module
 * - DatabaseModule - database initialization module
 * - HeartbeatModule - heartbeat module
 * - AddressBookModule - address book module
 * - AuditModule - audit module
 * - UserModule - user module
 * - DeviceGroupModule - device group module
 * - AuthModule - authentication module
 * - OidcModule - OIDC authentication module
 * - SysinfoModule - system info module
 * - DashboardModule - Dashboard statistics module
 *
 * Provides:
 * - ThrottlerGuard - global throttler guard
 * - JwtAuthGuard - global JWT authentication guard
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 100,
      },
    ]),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...createDataSourceOptions(), retryAttempts: 0 }),
      dataSourceFactory: async (options) => {
        if (!options) throw new Error('Missing database configuration');
        const dataSource = new DataSource(options);
        await dataSource.initialize();
        try {
          if (await dataSource.showMigrations()) {
            throw new Error(
              'Database migrations are pending. Run the migration command before starting the server.',
            );
          }
          return dataSource;
        } catch (error) {
          await dataSource.destroy();
          throw error;
        }
      },
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
    DashboardModule,
    SettingsModule,
    LdapModule,
    StrategyModule,
    UpdateCheckModule,
    NexusModule,
    UserGroupModule,
    RbacModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: DeviceThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RbacGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ConsoleAuditInterceptor,
    },
  ],
})
export class AppModule {}
