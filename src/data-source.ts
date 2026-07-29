import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from './entities';
import { InitialSchema1785305180672 } from './migrations/1785305180672-InitialSchema';

/**
 * TypeORM CLI 专用数据源配置
 * 用于 migration:generate / migration:run / migration:revert 等 CLI 命令
 *
 * 注意：此文件独立于 NestJS 运行，通过 ts-node 加载
 * 实体列表与 app.module.ts 共享 src/entities/index.ts
 */
export default new DataSource({
  type: 'sqlite',
  database: process.env.DB_PATH || 'rustdesk-console.db',
  entities: ALL_ENTITIES,
  migrations: [InitialSchema1785305180672],
  synchronize: false,
});
