import { MigrationInterface, QueryRunner } from 'typeorm';
import { isMySqlFamily } from '../database/mysql-dialect';

export class AddCustomClientBuildVersion1794800000000
  implements MigrationInterface
{
  name = 'AddCustomClientBuildVersion1794800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('custom_client_builds'))) {
      return;
    }
    if (await queryRunner.hasColumn('custom_client_builds', 'rustdeskVersion'))
      return;

    const type = queryRunner.connection.options.type;

    if (type === 'sqlite') {
      await queryRunner.query(
        'ALTER TABLE "custom_client_builds" ADD "rustdeskVersion" varchar(32)',
      );
      return;
    }

    if (isMySqlFamily(type)) {
      await queryRunner.query(
        'ALTER TABLE `custom_client_builds` ADD `rustdeskVersion` varchar(32) NULL',
      );
      return;
    }

    throw new Error(`Unsupported database type: ${type}`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('custom_client_builds'))) {
      return;
    }
    if (await queryRunner.hasColumn('custom_client_builds', 'rustdeskVersion'))
      await queryRunner.dropColumn('custom_client_builds', 'rustdeskVersion');
  }
}
