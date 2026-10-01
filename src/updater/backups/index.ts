import type { BackupAdapter, DatabaseConfig } from '../contracts';
import { MysqlBackupAdapter } from './mysql';
import { SqliteBackupAdapter } from './sqlite';

export function createBackupAdapter(database: DatabaseConfig): BackupAdapter {
  return database.kind === 'mysql'
    ? new MysqlBackupAdapter()
    : new SqliteBackupAdapter();
}
