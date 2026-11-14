import { IsString, IsOptional, IsIn } from 'class-validator';
import { DeviceSortQueryDto } from './device-sort.dto';

/**
 * Device query DTO
 * Used to fetch the list of accessible devices; supports pagination and multi-condition filtering
 */
export class PeerQueryDto extends DeviceSortQueryDto {
  @IsOptional()
  @IsString()
  accessible?: string; // compatibility field; an empty string means fetch all accessible devices

  @IsOptional()
  @IsString()
  id?: string; // filter by device ID (fuzzy match)

  @IsOptional()
  @IsString()
  @IsIn(['0', '1'])
  status?: string; // filter by device status: '0' = disabled, '1' = normal

  @IsOptional()
  @IsString()
  @IsIn(['0', '1'])
  is_online?: string; // filter by online status: '0' = offline, '1' = online

  @IsOptional()
  @IsString()
  user_name?: string; // filter by user name (fuzzy match)

  @IsOptional()
  @IsString()
  device_group_guid?: string; // filter by device group GUID (exact match)

  @IsOptional()
  @IsString()
  device_group_name?: string; // filter by device group name (fuzzy match)

  @IsOptional()
  @IsString()
  os?: string; // filter by operating system (fuzzy match)
}
