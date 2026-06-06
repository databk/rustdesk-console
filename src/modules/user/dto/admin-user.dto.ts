import {
  IsString,
  IsNumber,
  Min,
  IsInt,
  IsOptional,
  IsIn,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UserStatus } from '../entities/user.entity';

export class AdminUserQueryDto {
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
}
