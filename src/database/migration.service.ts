import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * MigrationService
 * 在生产环境中负责数据库迁移的执行
 *
 * 职责：
 * 1. 检测已有数据库（从 synchronize 迁移过来的），标记初始迁移为已执行
 * 2. 执行所有待处理的数据库迁移
 *
 * 设计说明：
 * 此服务不使用 OnModuleInit，而是由 DatabaseInitService 在种子数据初始化前显式调用，
 * 以确保迁移在种子数据操作之前完成。
 * 不能使用 migrationsRun: true，因为 TypeORM 在 DataSource 初始化阶段执行迁移，
 * 早于任何 NestJS 的 OnModuleInit 钩子，无法在迁移执行前标记已有数据库的初始迁移。
 */
@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(
    @InjectDataSource()
    private dataSource: DataSource,
  ) {}

  /**
   * 在生产环境中运行数据库迁移（包括已有数据库的初始迁移标记）
   * 应在 DatabaseInitService 的种子数据操作之前调用
   */
  async runMigrationsIfNeeded(): Promise<void> {
    if (process.env.NODE_ENV !== 'production') return;

    await this.markInitialMigrationAsRunIfNeeded();
    await this.runPendingMigrations();
  }

  /**
   * 执行所有待处理的数据库迁移
   */
  private async runPendingMigrations(): Promise<void> {
    try {
      const hasPending = await this.dataSource.showMigrations();
      if (hasPending) {
        this.logger.log('Running pending database migrations...');
        await this.dataSource.runMigrations({ transaction: 'all' });
        this.logger.log('Migrations completed successfully');
      } else {
        this.logger.log('No pending migrations');
      }
    } catch (error) {
      this.logger.error(
        `Failed to run migrations: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * 标记初始迁移为已执行（针对从 synchronize 迁移过来的已有数据库）
   *
   * 场景：生产环境中已有通过 synchronize: true 创建的数据库，
   * 启用迁移后 TypeORM 会认为初始迁移未执行而尝试重新建表。
   * 此方法检测已有数据库并标记初始迁移为已执行，避免重复建表。
   */
  private async markInitialMigrationAsRunIfNeeded(): Promise<void> {
    const initialMigrationName = 'InitialSchema1785305180672';

    try {
      // 检查 migrations 表是否存在
      const hasMigrationsTable = await this.dataSource.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'",
      );

      if (hasMigrationsTable.length === 0) {
        // migrations 表不存在，说明是全新数据库，TypeORM 会正常执行迁移
        return;
      }

      // 检查初始迁移是否已记录
      const existingRecord = await this.dataSource.query(
        'SELECT * FROM migrations WHERE name = ?',
        [initialMigrationName],
      );

      if (existingRecord.length > 0) {
        // 初始迁移已记录，无需处理
        return;
      }

      // migrations 表存在但初始迁移未记录 → 检查核心表是否存在
      const hasUsersTable = await this.dataSource.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
      );

      if (hasUsersTable.length > 0) {
        // 核心表存在，说明是从 synchronize 迁移过来的已有数据库
        await this.dataSource.query(
          'INSERT INTO migrations (timestamp, name) VALUES (?, ?)',
          [1785305180672, initialMigrationName],
        );
        this.logger.log(
          'Marked initial migration as already executed for existing database',
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to check migration status: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
