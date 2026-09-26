import {
  IsString,
  IsInt,
  IsBoolean,
  Min,
  Max,
  IsOptional,
  IsNumber,
  MaxLength,
} from 'class-validator';
import { FileAuditType } from '../entities/file-audit.entity';

/**
 * FileAuditDto
 * Used to record file transfer audit information
 */
export class FileAuditDto {
  @IsString()
  id: string;

  @IsString()
  uuid: string;

  @IsString()
  peer_id: string;

  @IsNumber()
  @IsOptional()
  conn_id?: number;

  @IsInt()
  @Min(0)
  @Max(1)
  type: FileAuditType;

  @IsString()
  @IsOptional()
  path?: string;

  @IsBoolean()
  is_file: boolean;

  @IsString()
  info: string;

  @IsString()
  @IsOptional()
  @MaxLength(36)
  nonce?: string;
}
