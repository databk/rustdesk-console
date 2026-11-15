import { MigrationInterface, QueryRunner } from 'typeorm';
import { isMariaDb, isMySqlFamily } from '../database/mysql-dialect';

/**
 * Enforce a single default user group on MariaDB.
 *
 * MySQL 8.0.13+ uses a functional index for this (see
 * FixMySqlDefaultUserGroupIndex1790985600001) and SQLite uses a partial index.
 * MariaDB supports neither, so the CASE expression is materialized as a
 * persisted generated column and a plain unique index is created on it.
 *
 * TypeORM cannot model a generated column that no entity declares, but it does
 * read the generation expression of every generated column from its internal
 * `typeorm_metadata` table, which the schema builder only creates when an
 * entity declares one. Create the table and record the column here so schema
 * diffs keep working; see src/database/schema-diff.ts for the matching filter.
 */
export class SupportMariaDbDefaultGroupIndex1794700800000 implements MigrationInterface {
  name = 'SupportMariaDbDefaultGroupIndex1794700800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!isMySqlFamily(queryRunner.connection.options.type)) return;
    if (!(await isMariaDb(queryRunner))) return;

    const table = await queryRunner.getTable('user_groups');
    if (!table) throw new Error('Missing user_groups table');
    if (
      table.indices.some(
        (index) => index.name === 'UQ_user_groups_single_default',
      )
    ) {
      await queryRunner.query(
        'DROP INDEX `UQ_user_groups_single_default` ON `user_groups`',
      );
    }

    const expression = 'CASE WHEN `isDefault` = 1 THEN 1 ELSE NULL END';
    if (!table.columns.some((column) => column.name === 'isDefaultKey')) {
      await queryRunner.query(
        `ALTER TABLE \`user_groups\` ADD COLUMN \`isDefaultKey\` tinyint GENERATED ALWAYS AS (${expression}) PERSISTENT`,
      );
    }

    await queryRunner.query(
      'CREATE UNIQUE INDEX `UQ_user_groups_default_key` ON `user_groups` (`isDefaultKey`)',
    );

    // Same definition TypeORM's RdbmsSchemaBuilder#createTypeormMetadataTable
    // generates for MySQL.
    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS `typeorm_metadata` (`type` varchar(255) NOT NULL, `database` varchar(255) NULL, `schema` varchar(255) NULL, `table` varchar(255) NULL, `name` varchar(255) NULL, `value` text NULL) ENGINE=InnoDB',
    );
    const database = await queryRunner.getCurrentDatabase();
    const existing = (await queryRunner.query(
      'SELECT 1 FROM `typeorm_metadata` WHERE `type` = ? AND `name` = ? AND `schema` = ? AND `table` = ?',
      ['GENERATED_COLUMN', 'isDefaultKey', database, 'user_groups'],
    )) as unknown[];
    if (existing.length === 0) {
      await queryRunner.query(
        'INSERT INTO `typeorm_metadata` (`type`, `database`, `schema`, `table`, `name`, `value`) VALUES (?, ?, ?, ?, ?, ?)',
        [
          'GENERATED_COLUMN',
          database,
          database,
          'user_groups',
          'isDefaultKey',
          expression,
        ],
      );
    }
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Reverting the default-group index could invalidate existing groups; restore a database backup instead.',
      ),
    );
  }
}
