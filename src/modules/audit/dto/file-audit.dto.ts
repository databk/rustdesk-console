import { IsString, IsInt, IsBoolean, Min, Max, IsOptional } from 'class-validator';
import { FileAuditType } from '../entities/file-audit.entity';

/**
 * FileAuditDto
 * 用于记录文件传输审计信息
 */
export class FileAuditDto {
  @IsString()
  id: string;

  @IsString()
  uuid: string;

  @IsString()
  peer_id: string;

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
}
