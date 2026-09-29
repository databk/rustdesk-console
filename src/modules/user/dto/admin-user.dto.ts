import {
  IsString,
  IsNumber,
  Min,
  Max,
  IsInt,
  IsOptional,
  IsIn,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UserStatus } from '../entities/user.entity';

export class AdminUserQueryDto {
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

  @IsEnum(UserStatus)
  @IsOptional()
  @Type(() => Number)
  status?: UserStatus;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsNumber()
  @IsIn([0, 1])
  @IsOptional()
  @Type(() => Number)
  is_admin?: number;

  @IsString()
  @IsOptional()
  third_auth_type?: string;

  @IsString()
  @IsOptional()
  strategy_name?: string;

  @IsString()
  @IsOptional()
  user_group_guid?: string;

  @IsString()
  @IsOptional()
  user_group_name?: string;
}
