import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeviceTombstoneReleaseTracking1791126400000 implements MigrationInterface {
  name = 'AddDeviceTombstoneReleaseTracking1791126400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('device_tombstones'))) {
      return;
    }

    const type = queryRunner.connection.options.type;

    if (type === 'sqlite') {
      if (
        !(await queryRunner.hasColumn('device_tombstones', 'releaseRequested'))
      )
        await queryRunner.query(
          'ALTER TABLE "device_tombstones" ADD "releaseRequested" boolean NOT NULL DEFAULT (0)',
        );
      if (!(await queryRunner.hasColumn('device_tombstones', 'idReleased')))
        await queryRunner.query(
          'ALTER TABLE "device_tombstones" ADD "idReleased" boolean NOT NULL DEFAULT (0)',
        );
      return;
    }

    if (type === 'mysql') {
      if (
        !(await queryRunner.hasColumn('device_tombstones', 'releaseRequested'))
      )
        await queryRunner.query(
          'ALTER TABLE `device_tombstones` ADD `releaseRequested` tinyint NOT NULL DEFAULT 0',
        );
      if (!(await queryRunner.hasColumn('device_tombstones', 'idReleased')))
        await queryRunner.query(
          'ALTER TABLE `device_tombstones` ADD `idReleased` tinyint NOT NULL DEFAULT 0',
        );
      return;
    }

    throw new Error(`Unsupported database type: ${type}`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('device_tombstones'))) {
      return;
    }
    if (await queryRunner.hasColumn('device_tombstones', 'idReleased'))
      await queryRunner.dropColumn('device_tombstones', 'idReleased');
    if (await queryRunner.hasColumn('device_tombstones', 'releaseRequested'))
      await queryRunner.dropColumn('device_tombstones', 'releaseRequested');
  }
}
