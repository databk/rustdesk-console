import { Min, Max, IsInt, IsString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 设备组查询DTO
 * 用于获取可访问设备组列表
 */
export class DeviceGroupQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  current?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsString()
  @IsOptional()
  name?: string;
}
