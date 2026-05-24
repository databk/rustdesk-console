import {
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  Min,
  Max,
  IsNumber,
  MaxLength,
} from 'class-validator';

/**
 * ConnectionAuditDto
 * 用于记录连接审计信息，支持连接状态上报和备注添加
 */
export class ConnectionAuditDto {
  @IsString()
  id: string;

  @IsString()
  @IsOptional()
  uuid?: string;

  @IsNumber()
  @IsOptional()
  conn_id?: number;

  @IsNumber()
  @IsOptional()
  session_id?: number;

  // ip 字段在 action 为 close 时可能不发送
  @IsString()
  @IsOptional()
  ip?: string;

  @IsString()
  @IsOptional()
  action?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  peer?: string[];

  @IsInt()
  @Min(0)
  @Max(4)
  @IsOptional()
  type?: number;

  @IsString()
  @IsOptional()
  @MaxLength(256)
  note?: string;
}
