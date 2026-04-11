import { IsString, IsOptional, IsArray, IsInt, Min, Max, IsNumber } from 'class-validator';

/**
 * ConnectionAuditDto
 * 用于记录连接审计信息
 */
export class ConnectionAuditDto {
  @IsString()
  id: string;

  @IsString()
  uuid: string;

  @IsNumber()
  conn_id: number;

  @IsNumber()
  session_id: number;

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
}
