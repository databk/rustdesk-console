import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * 更新设备DTO
 * 用于部分更新设备属性
 * 传字符串值 -> 按名称查找并关联
 * 传 null -> 清除关联
 * 不传某字段 -> 不修改该属性
 */
export class UpdateDeviceDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  userName?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  deviceGroupName?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  strategyName?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
