import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { DataSource } from 'typeorm';
import { createDataSourceOptions } from './data-source-options';
import { baselineExistingDatabase, migrateDatabase } from './migration-manager';

export async function runMigrationCommand(command = 'run'): Promise<void> {
  const options = createDataSourceOptions();
  if (options.type === 'sqlite')
    mkdirSync(dirname(options.database), { recursive: true });
  const dataSource = new DataSource(options);
  await dataSource.initialize();
  try {
    if (command === 'run') {
      await migrateDatabase(dataSource);
    } else if (command === 'baseline') {
      const adopted = await baselineExistingDatabase(dataSource);
      if (!adopted)
        throw new Error('There is no unbaselined existing database');
    } else if (command === 'show') {
      const pending = await dataSource.showMigrations();
      console.log(
        pending
          ? 'Database migrations are pending'
          : 'Database migrations are current',
      );
    } else {
      throw new Error(`Unknown migration command: ${command}`);
    }
  } finally {
    await dataSource.destroy();
  }
}
