import { IsString, IsNumber, IsNotEmpty } from 'class-validator';

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
}
