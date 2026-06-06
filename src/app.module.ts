import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DatabaseModule } from './database/database.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { SettingsModule } from './modules/settings/settings.module';
import { StrategyModule } from './modules/strategy/strategy.module';
import { getDatabaseConfig } from './database/database.config';

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
 * - DashboardModule - Dashboard统计模块
 *
 * 提供服务：
 * - ThrottlerGuard - 全局限流守卫
 * - JwtAuthGuard - 全局JWT认证守卫
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
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getDatabaseConfig,
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
    StrategyModule,
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
