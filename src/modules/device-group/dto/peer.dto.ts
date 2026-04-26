import { IsString, IsNumber, Min, IsInt, IsOptional, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 设备查询DTO
 * 用于获取可访问设备列表，支持分页和多条件筛选
 */
export class PeerQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsInt()
  current?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsInt()
  pageSize?: number = 100;

  @IsOptional()
  @IsString()
  id?: string; // 按设备ID筛选（模糊匹配）

  @IsOptional()
  @IsString()
  @IsIn(['0', '1'])
  status?: string; // 按设备状态筛选：'0'=禁用, '1'=正常

  @IsOptional()
  @IsString()
  @IsIn(['0', '1'])
  is_online?: string; // 按是否在线筛选：'0'=离线, '1'=在线

  @IsOptional()
  @IsString()
  user_name?: string; // 按用户名筛选（模糊匹配）

  @IsOptional()
  @IsString()
  device_group_name?: string; // 按设备组名称筛选（模糊匹配）

  @IsOptional()
  @IsString()
  os?: string; // 按操作系统筛选（模糊匹配）
}
