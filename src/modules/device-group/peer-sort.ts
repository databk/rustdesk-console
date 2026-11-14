import type { SelectQueryBuilder } from 'typeorm';
import { Sysinfo } from '../../common/entities/sysinfo.entity';
import { User } from '../user/entities/user.entity';
import type { DeviceSortField, DeviceSortOrder } from './dto/device-sort.dto';

/**
 * Sort a peer query by one of the whitelisted device fields.
 *
 * Sorting on values that live in related tables (`sysinfos`, `users`) uses
 * conditional left joins instead of correlated subqueries so the database can
 * use the primary-key indexes on both tables. The sort expression is also
 * added to the SELECT list under an alias, because TypeORM rewrites ORDER BY
 * clauses for paginated queries that contain joins and can only reference
 * columns that the subquery actually selects.
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
  let expression: string;

  switch (sortBy) {
    case 'device_name':
      queryBuilder.leftJoin(
        Sysinfo,
        'peer_sort_sysinfo',
        'peer_sort_sysinfo.uuid = peer.uuid',
      );
      expression = 'peer_sort_sysinfo.hostname';
      break;
    case 'user_name':
      queryBuilder.leftJoin(
        User,
        'peer_sort_user',
        'peer_sort_user.guid = peer.userGuid',
      );
      expression = 'peer_sort_user.username';
      break;
    case 'device_group_name':
      expression = `${deviceGroupAlias}.name`;
      break;
    case 'status':
      expression = 'peer.status';
      break;
    case 'note':
      expression = 'peer.note';
      break;
    case 'id':
    default:
      queryBuilder.orderBy('peer.id', direction);
      return;
  }

  queryBuilder.addSelect(expression, 'peer_sort_value');
  queryBuilder.orderBy('peer_sort_value', direction);
  queryBuilder.addOrderBy('peer.id', 'ASC');
}
