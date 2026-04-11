import { IsString, IsOptional, IsBoolean, IsObject, IsEmail } from 'class-validator';

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
  @IsString()
  type?: string; // account, mobile, sms_code, email_code, tfa_code

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
  @IsObject()
  deviceInfo?: Record<string, any>;
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
