import {
  IsNumber,
  Min,
  IsInt,
  IsString,
  IsOptional,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Device query DTO
 * Used to fetch the device list
 */
export class DeviceQueryDto {
  @IsNumber()
  @Min(1)
  @IsInt()
  @Type(() => Number)
  current: number;

  @IsNumber()
  @Min(1)
  @IsInt()
  @Type(() => Number)
  pageSize: number;

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
