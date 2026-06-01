import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsNumber,
  Min,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateStrategyDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsObject()
  @IsOptional()
  config_options?: Record<string, string>;
}

export class UpdateStrategyDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsObject()
  @IsOptional()
  config_options?: Record<string, string>;
}

export class AssignStrategyDto {
  @IsString()
  @IsNotEmpty()
  target_type: 'device' | 'user' | 'device_group';

  @IsString()
  @IsNotEmpty()
  target_guid: string;
}

export class StrategyQueryDto {
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
