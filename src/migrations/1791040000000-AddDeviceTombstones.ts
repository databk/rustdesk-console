import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeviceTombstones1791040000000 implements MigrationInterface {
  name = 'AddDeviceTombstones1791040000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('device_tombstones')) {
      return;
    }

    const type = queryRunner.connection.options.type;

    if (type === 'sqlite') {
      await queryRunner.query(
        'CREATE TABLE "device_tombstones" ("uuid" varchar PRIMARY KEY NOT NULL, "deviceId" varchar NOT NULL, "banned" boolean NOT NULL DEFAULT (0), "deletedBy" varchar, "createdAt" datetime NOT NULL DEFAULT (datetime(\'now\')))',
      );
      await queryRunner.query(
        'CREATE INDEX "IDX_device_tombstones_deviceId" ON "device_tombstones" ("deviceId") ',
      );
      return;
    }

    if (type === 'mysql') {
      await queryRunner.query(
        'CREATE TABLE `device_tombstones` (`uuid` varchar(255) NOT NULL, `deviceId` varchar(255) NOT NULL, `banned` tinyint NOT NULL DEFAULT 0, `deletedBy` varchar(255) NULL, `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX `IDX_device_tombstones_deviceId` (`deviceId`), PRIMARY KEY (`uuid`)) ENGINE=InnoDB',
      );
      return;
    }

    throw new Error(`Unsupported database type: ${type}`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('device_tombstones', true);
  }
}
