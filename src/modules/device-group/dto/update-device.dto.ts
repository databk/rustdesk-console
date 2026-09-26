import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * Update device DTO
 * Used to partially update device properties
 * Pass a string value -> look up by name and associate
 * Pass null -> clear the association
 * Omit a field -> that property is left unchanged
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
