import { IsNumber, Min, IsInt, IsString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 用户查询DTO
 * 用于获取可访问用户列表
 */
export class UserQueryDto {
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
