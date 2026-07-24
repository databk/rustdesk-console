import {
  IsString,
  IsOptional,
  IsBoolean,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types';

/**
 * Passkey 登录设备信息
 */
class PasskeyAuthDeviceInfoDto {
  @IsOptional()
  @IsString()
  os?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  name?: string;
}

/**
 * Passkey 注册验证 DTO
 * 客户端在 navigator.credentials.create() 后提交此数据
 */
export class VerifyPasskeyRegistrationDto {
  @IsObject()
  response!: RegistrationResponseJSON;

  @IsOptional()
  @IsString()
  name?: string;
}

/**
 * Passkey 登录发起 DTO
 * 可选传入设备信息
 */
export class BeginPasskeyAuthDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  uuid?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PasskeyAuthDeviceInfoDto)
  deviceInfo?: PasskeyAuthDeviceInfoDto;
}

/**
 * Passkey 登录验证 DTO
 * 客户端在 navigator.credentials.get() 后提交此数据
 */
export class VerifyPasskeyAuthDto {
  @IsString()
  secret!: string;

  @IsObject()
  response!: AuthenticationResponseJSON;

  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  uuid?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PasskeyAuthDeviceInfoDto)
  deviceInfo?: PasskeyAuthDeviceInfoDto;
}

/**
 * Passkey 双因素认证开关 DTO
 */
export class TogglePasskeyTfaDto {
  @IsBoolean()
  enabled!: boolean;
}
