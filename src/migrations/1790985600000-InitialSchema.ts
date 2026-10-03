import { MigrationInterface, QueryRunner } from 'typeorm';
import { INITIAL_SCHEMA_SQLITE } from './initial-schema-sqlite';
import { INITIAL_SCHEMA_MYSQL } from './initial-schema-mysql';

export class InitialSchema1790985600000 implements MigrationInterface {
  name = 'InitialSchema1790985600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const type = queryRunner.connection.options.type;
    const statements =
      type === 'sqlite'
        ? INITIAL_SCHEMA_SQLITE
        : type === 'mysql'
          ? INITIAL_SCHEMA_MYSQL
          : null;
    if (!statements) throw new Error(`Unsupported database type: ${type}`);
    for (const statement of statements) {
      await queryRunner.query(statement);
    }
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'The initial schema migration cannot be reverted; restore a database backup instead.',
      ),
    );
  }
}
