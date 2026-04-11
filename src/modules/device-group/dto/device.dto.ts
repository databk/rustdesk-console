import { IsNumber, Min, IsInt, IsString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 设备查询DTO
 * 用于获取设备列表
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
  device_group_name?: string;
}
