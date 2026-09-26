import { IsNumber, Min, IsInt, IsString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Device group query DTO
 * Used to fetch the list of accessible device groups
 */
export class DeviceGroupQueryDto {
  @IsNumber()
  @Min(1)
  @IsInt()
  @Type(() => Number)
  current: number;

  @IsNumber()
  @Min(1)
  @IsInt()
  @Type(() => Number)
  pageSize: number;

  @IsString()
  @IsOptional()
  name?: string;
}
