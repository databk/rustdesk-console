import { IsNumber, IsBoolean, IsOptional, Min, Max } from 'class-validator';

/**
 * 更新审计日志保留配置 DTO
 * 所有字段可选，仅更新传入的字段
 */
export class UpdateAuditConfigDto {
  /**
   * 日志保留天数
   * 超过此天数的审计日志将被自动清理
   * 设为 0 表示不自动清理
   */
  @IsNumber()
  @Min(0)
  @Max(3650)
  @IsOptional()
  retentionDays?: number;

  /**
   * 是否启用自动清理
   */
  @IsBoolean()
  @IsOptional()
  autoCleanupEnabled?: boolean;
}
