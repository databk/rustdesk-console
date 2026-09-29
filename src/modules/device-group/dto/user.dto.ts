import { IsString, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/**
 * 用户查询DTO
 * 用于获取可访问用户列表
 */
export class UserQueryDto extends PaginationQueryDto {
  @IsString()
  @IsOptional()
  accessible?: string; // 空字符串表示获取可访问的用户

  @IsString()
  @IsOptional()
  status?: string; // '1' 表示只获取正常状态的用户

  @IsString()
  @IsOptional()
  name?: string; // 用户名过滤，支持模糊匹配

  @IsString()
  @IsOptional()
  group_name?: string; // 组名过滤，支持模糊匹配
}
