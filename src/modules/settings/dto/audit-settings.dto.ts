import { IsInt, Min } from 'class-validator';

export class AuditSettingsDto {
  retentionDays: number;
}

export class UpdateAuditSettingsDto {
  @IsInt()
  @Min(0)
  retentionDays: number;
}