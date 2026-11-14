import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/**
 * Fields that device lists can be sorted by.
 *
 * The whitelist is intentionally limited to columns exposed by the console UI:
 * arbitrary ORDER BY expressions would allow SQL injection through the query
 * string.
 */
export const DEVICE_SORT_FIELDS = [
  'id',
  'device_name',
  'device_group_name',
  'user_name',
  'status',
  'note',
] as const;

export type DeviceSortField = (typeof DEVICE_SORT_FIELDS)[number];

export const DEVICE_SORT_ORDERS = ['asc', 'desc'] as const;

export type DeviceSortOrder = (typeof DEVICE_SORT_ORDERS)[number];

/**
 * Pagination query that also accepts device sorting parameters.
 *
 * Shared by the administrator device list and the accessible peer list so both
 * endpoints expose identical ordering semantics.
 */
export class DeviceSortQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(DEVICE_SORT_FIELDS)
  sort_by?: DeviceSortField;

  @IsOptional()
  @IsString()
  @IsIn(DEVICE_SORT_ORDERS)
  sort_order?: DeviceSortOrder;
}
