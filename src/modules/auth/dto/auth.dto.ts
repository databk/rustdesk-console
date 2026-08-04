import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEmail,
  IsIn,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LOGIN_TYPE_VALUES } from '../auth.constants';

/**
 * DeviceInfoDto
 * 设备信息数据传输对象
 * 客户端自动填充，包含操作系统、来源类型和设备名称
 */
export class DeviceInfoDto {
  @IsOptional()
  @IsString()
  os?: string; // 操作系统（如 linux, windows, android）

  @IsOptional()
  @IsString()
  type?: string; // 来源类型（"client" 表示客户端，"browser" 表示浏览器）

  @IsOptional()
  @IsString()
  name?: string; // 设备名称（客户端取自主机名 hostname）
}

/**
 * LoginDto
 * 用于用户登录请求，支持多种登录方式
 */
export class LoginDto {
  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  id?: string; // 设备ID

  @IsOptional()
  @IsString()
  uuid?: string; // 设备UUID

  @IsOptional()
  @IsBoolean()
  autoLogin?: boolean;

  @IsOptional()
  @IsIn(LOGIN_TYPE_VALUES)
  type?: string;

  @IsOptional()
  @IsString()
  verificationCode?: string;

  @IsOptional()
  @IsString()
  tfaCode?: string;

  @IsOptional()
  @IsString()
  secret?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceInfoDto)
  deviceInfo?: DeviceInfoDto;
}

/**
 * RegisterDto
 * 用于新用户注册
 */
export class RegisterDto {
  @IsString()
  username: string;

  @IsEmail()
  email: string;

  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  note?: string;
}

/**
 * CurrentUserDto
 * 用于获取当前用户信息
 */
export class CurrentUserDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  uuid?: string;
}

/**
 * LogoutDto
 * 用于用户登出请求
 */
export class LogoutDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  uuid?: string;
}

export class SetupTfaDto {
  @IsOptional()
  @IsString()
  current_code?: string;
}

export class VerifyTfaDto {
  @IsString()
  code: string;
}

export class DisableTfaDto {
  @IsString()
  code: string;
}
