import {
  IsString,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsNumber,
  MaxLength,
} from 'class-validator';

/**
 * AlarmAuditDto
 * 用于记录告警审计信息
 */
export class AlarmAuditDto {
  @IsString()
  id: string;

  @IsString()
  uuid: string;

  @IsInt()
  @Min(0)
  @Max(10)
  typ: number;

  @IsString()
  info: string;

  @IsNumber()
  @IsOptional()
  conn_id?: number;

  @IsString()
  @IsOptional()
  @MaxLength(36)
  nonce?: string;

  @IsString()
  @IsOptional()
  conn_audit_ref?: string;
}
