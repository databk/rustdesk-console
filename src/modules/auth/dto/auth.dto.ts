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
 * Device info data transfer object
 * Auto-filled by the client; contains the operating system, source type, and device name
 */
export class DeviceInfoDto {
  @IsOptional()
  @IsString()
  os?: string; // Operating system (e.g. linux, windows, android)

  @IsOptional()
  @IsString()
  type?: string; // Source type ("client" for the client app, "browser" for a browser)

  @IsOptional()
  @IsString()
  name?: string; // Device name (the client uses its hostname)
}

/**
 * LoginDto
 * Used for user login requests; supports multiple login methods
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
  id?: string; // Device ID

  @IsOptional()
  @IsString()
  uuid?: string; // Device UUID

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
 * Used for new user registration
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
 * Used to get the current user's info
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
 * Used for user logout requests
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
