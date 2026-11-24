import { MigrationInterface, QueryRunner } from 'typeorm';
import { isMySqlFamily } from '../database/mysql-dialect';

export class AddStrategyRustdeskVersion1794900000000
  implements MigrationInterface
{
  name = 'AddStrategyRustdeskVersion1794900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('strategies'))) {
      return;
    }
    if (await queryRunner.hasColumn('strategies', 'rustdeskVersion')) return;

    const type = queryRunner.connection.options.type;

    if (type === 'sqlite') {
      await queryRunner.query(
        'ALTER TABLE "strategies" ADD "rustdeskVersion" varchar(32)',
      );
      return;
    }

    if (isMySqlFamily(type)) {
      await queryRunner.query(
        'ALTER TABLE `strategies` ADD `rustdeskVersion` varchar(32) NULL',
      );
      return;
    }

    throw new Error(`Unsupported database type: ${type}`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('strategies'))) {
      return;
    }
    if (await queryRunner.hasColumn('strategies', 'rustdeskVersion'))
      await queryRunner.dropColumn('strategies', 'rustdeskVersion');
  }
}
