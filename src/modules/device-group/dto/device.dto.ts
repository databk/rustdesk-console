import { IsString, IsOptional, IsIn } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/**
 * 设备查询DTO
 * 用于获取设备列表
 */
export class DeviceQueryDto extends PaginationQueryDto {
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
