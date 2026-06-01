import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsArray,
  IsNumber,
  Min,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UserStatus } from '../entities/user.entity';

export class CreateUserDto {
  @IsString()
  name: string;

  @IsString()
  password: string;

  @IsString()
  @IsOptional()
  group_name?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  note?: string;
}

export class InviteUserDto {
  @IsString()
  email: string;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  group_name?: string;

  @IsString()
  @IsOptional()
  note?: string;
}

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;

  @IsBoolean()
  @IsOptional()
  is_admin?: boolean;
}

export class UpdateUserSecurityDto {
  @IsBoolean()
  @IsOptional()
  tfa_enforce?: boolean;

  @IsBoolean()
  @IsOptional()
  email_verification?: boolean;
}

export class UpdateCurrentUserDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  note?: string;
}

export class UserQueryDto {
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
  status?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  group_name?: string;
}

export class BatchStatusDto {
  @IsArray()
  @IsString({ each: true })
  user_guids: string[];

  @IsEnum(UserStatus)
  status: UserStatus;
}

export class BatchSecurityDto {
  @IsArray()
  @IsString({ each: true })
  user_guids: string[];

  @IsBoolean()
  @IsOptional()
  tfa_enforce?: boolean;

  @IsBoolean()
  @IsOptional()
  email_verification?: boolean;
}

export class BatchSessionsDto {
  @IsArray()
  @IsString({ each: true })
  user_guids: string[];
}
