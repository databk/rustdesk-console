import type { SelectQueryBuilder } from 'typeorm';
import { Sysinfo } from '../../common/entities/sysinfo.entity';
import { User } from '../user/entities/user.entity';
import type { DeviceSortField, DeviceSortOrder } from './dto/device-sort.dto';

/**
 * Sort a peer query by one of the whitelisted device fields.
 *
 * Entity columns (`status`, `note`, the device group name) are ordered by their
 * mapped property so TypeORM can still hydrate the full entity. Related values
 * that are not part of the entity selection (`hostname`, `username`) use
 * conditional left joins and are added to the SELECT list under an alias,
 * because TypeORM rewrites ORDER BY clauses for paginated queries that contain
 * joins and can only reference columns that the subquery actually selects.
 *
 * The device ID is always appended as a stable tie-breaker so pagination cannot
 * repeat or skip rows.
 *
 * @param queryBuilder Peer query builder, already joined with the device group
 * @param sortBy Whitelisted sort field, omitted for the default ID ordering
 * @param sortOrder Sort direction, defaults to ascending
 * @param deviceGroupAlias Alias of the joined device group relation
 */
export function applyPeerSort(
  queryBuilder: SelectQueryBuilder<any>,
  sortBy: DeviceSortField | undefined,
  sortOrder: DeviceSortOrder | undefined,
  deviceGroupAlias: string,
): void {
  if (!sortBy) {
    queryBuilder.orderBy('peer.id', 'ASC');
    return;
  }

  const direction = sortOrder === 'desc' ? 'DESC' : 'ASC';

  switch (sortBy) {
    case 'device_name':
      queryBuilder.leftJoin(
        Sysinfo,
        'peer_sort_sysinfo',
        'peer_sort_sysinfo.uuid = peer.uuid',
      );
      addSortSelection(queryBuilder, 'peer_sort_sysinfo.hostname', direction);
      return;
    case 'user_name':
      queryBuilder.leftJoin(
        User,
        'peer_sort_user',
        'peer_sort_user.guid = peer.userGuid',
      );
      addSortSelection(queryBuilder, 'peer_sort_user.username', direction);
      return;
    case 'device_group_name':
      orderByPeerProperty(queryBuilder, `${deviceGroupAlias}.name`, direction);
      return;
    case 'status':
      orderByPeerProperty(queryBuilder, 'peer.status', direction);
      return;
    case 'note':
      orderByPeerProperty(queryBuilder, 'peer.note', direction);
      return;
    case 'id':
    default:
      queryBuilder.orderBy('peer.id', direction);
  }
}

/**
 * Sort by a column that is already part of the entity selection.
 *
 * Re-aliasing such a column (for example `peer.status` as `peer_sort_value`)
 * makes TypeORM's entity transformer look for the custom alias and leaves the
 * original property undefined, so the mapped property is used directly.
 */
function orderByPeerProperty(
  queryBuilder: SelectQueryBuilder<any>,
  expression: string,
  direction: 'ASC' | 'DESC',
): void {
  queryBuilder.orderBy(expression, direction);
  queryBuilder.addOrderBy('peer.id', 'ASC');
}

/**
 * Sort by a related column that the entity selection does not include.
 *
 * The value must be added to the SELECT list because TypeORM rewrites ORDER BY
 * clauses for paginated queries with joins and can only reference columns the
 * subquery actually selects.
 */
function addSortSelection(
  queryBuilder: SelectQueryBuilder<any>,
  expression: string,
  direction: 'ASC' | 'DESC',
): void {
  queryBuilder.addSelect(expression, 'peer_sort_value');
  queryBuilder.orderBy('peer_sort_value', direction);
  queryBuilder.addOrderBy('peer.id', 'ASC');
}
