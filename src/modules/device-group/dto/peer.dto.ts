import { IsString, IsNumber, Min, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 设备查询DTO
 * 用于获取可访问设备列表
 */
export class PeerQueryDto {
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
  accessible: string; // 空字符串表示获取所有可访问设备

  @IsString()
  status: string; // '1' 表示只获取在线设备
}
