import { IsString, IsNumber, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

/**
 * HeartbeatDto
 * 用于设备心跳数据上报
 */
export class HeartbeatDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  uuid: string;

  @IsNumber()
  @IsNotEmpty()
  ver: number;

  @IsNumber()
  @IsNotEmpty()
  modified_at: number;

  /**
   * 当前活跃连接ID列表
   * 客户端上报当前持有的活跃连接，服务端据此维护连接状态
   */
  @IsOptional()
  @IsArray()
  conns?: number[];
}
