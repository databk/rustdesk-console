import {
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  Min,
  Max,
  IsNumber,
  MaxLength,
  IsDateString,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

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

  @IsString()
  @IsOptional()
  @MaxLength(256)
  note?: string;

  @IsString()
  @IsOptional()
  @MaxLength(36)
  nonce?: string;

  @IsString()
  @IsOptional()
  conn_audit_ref?: string;

  @IsInt()
  @Min(0)
  @Max(4)
  @IsOptional()
  primary_auth?: number;

  @IsInt()
  @Min(0)
  @Max(2)
  @IsOptional()
  two_factor?: number;
}

/**
 * UpdateConnectionAuditDto
 * 管理端更新连接审计记录
 */
export class UpdateConnectionAuditDto {
  @IsString()
  @MaxLength(256)
  note: string;
}

/**
 * 审计分页查询基类
 * 统一 current / pageSize 的定义、默认值与约束
 */
export class AuditPaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  current?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

export class ActiveConnectionQueryDto extends AuditPaginationQueryDto {
  @IsOptional()
  @IsString()
  deviceId?: string;
}

export class ConnectionAuditQueryDto extends AuditPaginationQueryDto {
  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1)
  @Max(4)
  type?: number;

  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsDateString()
  endTime?: string;
}

export class FileAuditQueryDto extends AuditPaginationQueryDto {
  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1)
  type?: number;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;
}

export class AlarmAuditQueryDto extends AuditPaginationQueryDto {
  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  type?: number;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;
}

export class ConsoleAuditQueryDto extends AuditPaginationQueryDto {
  @IsOptional()
  @IsString()
  operator?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  target_type?: string;

  @IsOptional()
  @IsIn(['allowed', 'denied'])
  result?: 'allowed' | 'denied';

  @IsOptional()
  @IsString()
  start_time?: string;

  @IsOptional()
  @IsString()
  end_time?: string;
}
