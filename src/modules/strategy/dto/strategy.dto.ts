import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

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

export class StrategyQueryDto extends PaginationQueryDto {
  @IsString()
  @IsOptional()
  name?: string;
}

export class StrategyCandidateDto {
  guid: string;
  name: string;
  note: string;
}

export class StrategyTargetCandidateQueryDto extends PaginationQueryDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['device', 'user'])
  target_type: 'device' | 'user';
}

export class AssignmentQueryDto extends PaginationQueryDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['device', 'user', 'device_group'])
  target_type: 'device' | 'user' | 'device_group';
}
