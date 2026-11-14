import { IsString, IsOptional, IsIn } from 'class-validator';
import { DeviceSortQueryDto } from './device-sort.dto';

/**
 * Device query DTO
 * Used to fetch the device list
 */
export class DeviceQueryDto extends DeviceSortQueryDto {
  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsIn(['0', '1'])
  @IsOptional()
  status?: string;

  @IsString()
  @IsIn(['0', '1'])
  @IsOptional()
  is_online?: string;

  @IsString()
  @IsOptional()
  device_name?: string;

  @IsString()
  @IsOptional()
  user_name?: string;

  @IsString()
  @IsOptional()
  device_username?: string;

  @IsString()
  @IsOptional()
  os?: string;

  @IsString()
  @IsOptional()
  device_group_name?: string;

  @IsString()
  @IsOptional()
  device_group_guid?: string;
}
