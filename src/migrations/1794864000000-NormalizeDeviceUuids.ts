import { MigrationInterface, QueryRunner } from 'typeorm';
import { normalizeDeviceUuid } from '../common/utils/device-uuid.util';

/**
 * Store device UUIDs in canonical UUID form.
 *
 * Clients and hbbs use standard base64 for the UUID, which may contain `/`.
 * The Console used to persist that text verbatim, so `PATCH /api/devices/:guid`
 * could never address such a device. Normalise every device-scoped table and
 * keep clone-isolation keys (64-character SHA-256 hex) untouched.
 */
export class NormalizeDeviceUuids1794864000000 implements MigrationInterface {
  name = 'NormalizeDeviceUuids1794864000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const quote =
      queryRunner.connection.options.type === 'sqlite'
        ? (name: string) => `"${name}"`
        : (name: string) => `\`${name}\``;

    const columns = [
      'uuid',
      'id',
      'userGuid',
      'deviceGroupGuid',
      'strategyGuid',
      'note',
      'status',
      'ver',
      'modifiedAt',
      'createdAt',
      'lastHeartbeat',
      'updatedAt',
    ];
    const columnList = columns.map(quote).join(', ');
    const peers = (await queryRunner.query(
      `SELECT ${columnList} FROM ${quote('peers')}`,
    )) as Array<Record<string, unknown>>;

    for (const peer of peers) {
      const oldUuid = String(peer.uuid);
      const canonical = normalizeDeviceUuid(oldUuid);
      if (canonical === oldUuid) continue;

      const target = (await queryRunner.query(
        `SELECT ${quote('uuid')} FROM ${quote('peers')} WHERE ${quote('uuid')} = ?`,
        [canonical],
      )) as unknown[];
      if (target.length > 0) {
        // The canonical row already exists (for example a device registered
        // after the upgrade). Keep it and merge the legacy metadata.
        await queryRunner.query(
          `UPDATE ${quote('peers')} SET ${quote('userGuid')} = COALESCE(${quote('userGuid')}, ?), ${quote('deviceGroupGuid')} = COALESCE(${quote('deviceGroupGuid')}, ?), ${quote('strategyGuid')} = COALESCE(${quote('strategyGuid')}, ?), ${quote('note')} = COALESCE(${quote('note')}, ?), ${quote('lastHeartbeat')} = COALESCE(${quote('lastHeartbeat')}, ?) WHERE ${quote('uuid')} = ?`,
          [
            peer.userGuid,
            peer.deviceGroupGuid,
            peer.strategyGuid,
            peer.note,
            peer.lastHeartbeat,
            canonical,
          ],
        );
      } else {
        await queryRunner.query(
          `INSERT INTO ${quote('peers')} (${columnList}) VALUES (${columns.map(() => '?').join(', ')})`,
          [canonical, ...columns.slice(1).map((column) => peer[column])],
        );
      }

      await this.repointChildren(queryRunner, quote, oldUuid, canonical);
      await queryRunner.query(
        `DELETE FROM ${quote('peers')} WHERE ${quote('uuid')} = ?`,
        [oldUuid],
      );
    }

    // Tombstones and orphaned system-info rows have no peer row (a tombstone
    // exists precisely because the peer was deleted), so they need their own
    // pass. Without it a deleted device could register again under the
    // canonical UUID and its tombstone would never match.
    await this.normalizeRemainingKeys(queryRunner, quote, 'sysinfos');
    await this.normalizeRemainingKeys(queryRunner, quote, 'device_tombstones');
  }

  async down(): Promise<void> {
    // The canonical form is the source of truth. Reversing would not restore
    // the exact client encoding (desktop and mobile clients base64 different
    // byte sequences), and every reader normalises the legacy text anyway.
  }

  private async repointChildren(
    queryRunner: QueryRunner,
    quote: (name: string) => string,
    oldUuid: string,
    canonical: string,
  ): Promise<void> {
    await queryRunner.query(
      `UPDATE ${quote('active_connections')} SET ${quote('deviceUuid')} = ? WHERE ${quote('deviceUuid')} = ?`,
      [canonical, oldUuid],
    );

    await this.movePrimaryKey(
      queryRunner,
      quote,
      'sysinfos',
      oldUuid,
      canonical,
    );
    await this.movePrimaryKey(
      queryRunner,
      quote,
      'device_tombstones',
      oldUuid,
      canonical,
    );
  }

  private async normalizeRemainingKeys(
    queryRunner: QueryRunner,
    quote: (name: string) => string,
    table: string,
  ): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT ${quote('uuid')} FROM ${quote(table)}`,
    )) as Array<{ uuid: unknown }>;
    for (const row of rows) {
      const oldUuid = String(row.uuid);
      const canonical = normalizeDeviceUuid(oldUuid);
      if (canonical === oldUuid) continue;
      await this.movePrimaryKey(queryRunner, quote, table, oldUuid, canonical);
    }
  }

  private async movePrimaryKey(
    queryRunner: QueryRunner,
    quote: (name: string) => string,
    table: string,
    oldUuid: string,
    canonical: string,
  ): Promise<void> {
    const target = (await queryRunner.query(
      `SELECT ${quote('uuid')} FROM ${quote(table)} WHERE ${quote('uuid')} = ?`,
      [canonical],
    )) as unknown[];
    if (target.length > 0) {
      await queryRunner.query(
        `DELETE FROM ${quote(table)} WHERE ${quote('uuid')} = ?`,
        [oldUuid],
      );
      return;
    }
    await queryRunner.query(
      `UPDATE ${quote(table)} SET ${quote('uuid')} = ? WHERE ${quote('uuid')} = ?`,
      [canonical, oldUuid],
    );
  }
}
