import { IsString, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/**
 * 设备组查询DTO
 * 用于获取可访问设备组列表
 */
export class DeviceGroupQueryDto extends PaginationQueryDto {
  @IsString()
  @IsOptional()
  name?: string;
}
