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
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * ConnectionAuditDto
 * Used to record connection audit information; supports connection status reporting and adding remarks
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

  // the ip field may not be sent when action is close
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
 * Admin-side update of a connection audit record
 */
export class UpdateConnectionAuditDto {
  @IsString()
  @MaxLength(256)
  note: string;
}

export class ActiveConnectionQueryDto {
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

  @IsOptional()
  @IsString()
  deviceId?: string;
}

export class ConnectionAuditQueryDto {
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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  pageSize?: number = 10;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  current?: number = 1;
}
