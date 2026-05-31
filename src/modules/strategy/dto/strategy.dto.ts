import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

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
  current: number = 1;
  pageSize: number = 100;
  name?: string;
}
