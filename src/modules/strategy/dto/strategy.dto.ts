import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  Min,
  IsInt,
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  Max,
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
  @IsIn(['device', 'user', 'device_group'])
  target_type: 'device' | 'user' | 'device_group';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  target_guids: string[];
}

export class StrategyQueryDto {
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

  @IsString()
  @IsOptional()
  name?: string;
}

export class StrategyCandidateDto {
  guid: string;
  name: string;
  note: string;
}

export class StrategyTargetCandidateQueryDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['device', 'user'])
  target_type: 'device' | 'user';

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
}

export class AssignmentQueryDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['device', 'user', 'device_group'])
  target_type: 'device' | 'user' | 'device_group';

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
}
