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

      if (oldUuid.toLowerCase() === canonical.toLowerCase()) {
        const distinctTarget = (await queryRunner.query(
          `SELECT ${quote('uuid')} FROM ${quote('peers')} WHERE ${quote('uuid')} = ? AND ${quote('uuid')} != ?`,
          [canonical, oldUuid],
        )) as unknown[];
        if (distinctTarget.length > 0) {
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
          await this.repointChildren(queryRunner, quote, oldUuid, canonical);
          await queryRunner.query(
            `DELETE FROM ${quote('peers')} WHERE ${quote('uuid')} = ?`,
            [oldUuid],
          );
        } else {
          await queryRunner.query(
            `UPDATE ${quote('peers')} SET ${quote('uuid')} = ? WHERE ${quote('uuid')} = ?`,
            [canonical, oldUuid],
          );
          await this.repointChildren(queryRunner, quote, oldUuid, canonical);
        }
        continue;
      }

      const target = (await queryRunner.query(
        `SELECT ${quote('uuid')} FROM ${quote('peers')} WHERE ${quote('uuid')} = ?`,
        [canonical],
      )) as unknown[];
      if (target.length > 0) {
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
    await this.normalizeRemainingAddressBookPeers(queryRunner, quote);
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

    await this.normalizeAddressBookPeers(
      queryRunner,
      quote,
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
    if (oldUuid.toLowerCase() === canonical.toLowerCase()) {
      const distinctTarget = (await queryRunner.query(
        `SELECT ${quote('uuid')} FROM ${quote(table)} WHERE ${quote('uuid')} = ? AND ${quote('uuid')} != ?`,
        [canonical, oldUuid],
      )) as unknown[];
      if (distinctTarget.length > 0) {
        if (table === 'device_tombstones') {
          const legacy = (await queryRunner.query(
            `SELECT ${quote('idReleased')} FROM ${quote(table)} WHERE ${quote('uuid')} = ?`,
            [oldUuid],
          )) as Array<{ idReleased: unknown }>;
          if (legacy.length > 0 && Boolean(legacy[0].idReleased)) {
            await queryRunner.query(
              `UPDATE ${quote(table)} SET ${quote('idReleased')} = ? WHERE ${quote('uuid')} = ?`,
              [true, canonical],
            );
          }
        }
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
      return;
    }

    const target = (await queryRunner.query(
      `SELECT ${quote('uuid')} FROM ${quote(table)} WHERE ${quote('uuid')} = ?`,
      [canonical],
    )) as unknown[];
    if (target.length > 0) {
      if (table === 'device_tombstones') {
        const legacy = (await queryRunner.query(
          `SELECT ${quote('idReleased')} FROM ${quote(table)} WHERE ${quote('uuid')} = ?`,
          [oldUuid],
        )) as Array<{ idReleased: unknown }>;
        if (legacy.length > 0 && Boolean(legacy[0].idReleased)) {
          await queryRunner.query(
            `UPDATE ${quote(table)} SET ${quote('idReleased')} = ? WHERE ${quote('uuid')} = ?`,
            [true, canonical],
          );
        }
      }
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

  private async normalizeAddressBookPeers(
    queryRunner: QueryRunner,
    quote: (name: string) => string,
    oldUuid: string,
    canonical: string,
  ): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT ${quote('guid')}, ${quote('addressBookGuid')} FROM ${quote('address_book_peers')} WHERE ${quote('deviceId')} = ?`,
      [oldUuid],
    )) as Array<{ guid: string; addressBookGuid: string }>;

    for (const row of rows) {
      if (oldUuid.toLowerCase() === canonical.toLowerCase()) {
        const distinctExisting = (await queryRunner.query(
          `SELECT ${quote('guid')} FROM ${quote('address_book_peers')} WHERE ${quote('addressBookGuid')} = ? AND ${quote('deviceId')} = ? AND ${quote('deviceId')} != ?`,
          [row.addressBookGuid, canonical, oldUuid],
        )) as unknown[];
        if (distinctExisting.length > 0) {
          await queryRunner.query(
            `DELETE FROM ${quote('address_book_peers')} WHERE ${quote('guid')} = ?`,
            [row.guid],
          );
        } else {
          await queryRunner.query(
            `UPDATE ${quote('address_book_peers')} SET ${quote('deviceId')} = ? WHERE ${quote('guid')} = ?`,
            [canonical, row.guid],
          );
        }
        continue;
      }

      const existing = (await queryRunner.query(
        `SELECT ${quote('guid')} FROM ${quote('address_book_peers')} WHERE ${quote('addressBookGuid')} = ? AND ${quote('deviceId')} = ?`,
        [row.addressBookGuid, canonical],
      )) as unknown[];

      if (existing.length > 0) {
        await queryRunner.query(
          `DELETE FROM ${quote('address_book_peers')} WHERE ${quote('guid')} = ?`,
          [row.guid],
        );
      } else {
        await queryRunner.query(
          `UPDATE ${quote('address_book_peers')} SET ${quote('deviceId')} = ? WHERE ${quote('guid')} = ?`,
          [canonical, row.guid],
        );
      }
    }
  }

  private async normalizeRemainingAddressBookPeers(
    queryRunner: QueryRunner,
    quote: (name: string) => string,
  ): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT ${quote('guid')}, ${quote('addressBookGuid')}, ${quote('deviceId')} FROM ${quote('address_book_peers')}`,
    )) as Array<{ guid: string; addressBookGuid: string; deviceId: string }>;

    for (const row of rows) {
      const oldDeviceId = String(row.deviceId);
      const canonical = normalizeDeviceUuid(oldDeviceId);
      if (canonical === oldDeviceId) continue;

      if (oldDeviceId.toLowerCase() === canonical.toLowerCase()) {
        const distinctExisting = (await queryRunner.query(
          `SELECT ${quote('guid')} FROM ${quote('address_book_peers')} WHERE ${quote('addressBookGuid')} = ? AND ${quote('deviceId')} = ? AND ${quote('deviceId')} != ?`,
          [row.addressBookGuid, canonical, oldDeviceId],
        )) as unknown[];
        if (distinctExisting.length > 0) {
          await queryRunner.query(
            `DELETE FROM ${quote('address_book_peers')} WHERE ${quote('guid')} = ?`,
            [row.guid],
          );
        } else {
          await queryRunner.query(
            `UPDATE ${quote('address_book_peers')} SET ${quote('deviceId')} = ? WHERE ${quote('guid')} = ?`,
            [canonical, row.guid],
          );
        }
        continue;
      }

      const existing = (await queryRunner.query(
        `SELECT ${quote('guid')} FROM ${quote('address_book_peers')} WHERE ${quote('addressBookGuid')} = ? AND ${quote('deviceId')} = ?`,
        [row.addressBookGuid, canonical],
      )) as unknown[];

      if (existing.length > 0) {
        await queryRunner.query(
          `DELETE FROM ${quote('address_book_peers')} WHERE ${quote('guid')} = ?`,
          [row.guid],
        );
      } else {
        await queryRunner.query(
          `UPDATE ${quote('address_book_peers')} SET ${quote('deviceId')} = ? WHERE ${quote('guid')} = ?`,
          [canonical, row.guid],
        );
      }
    }
  }
}
