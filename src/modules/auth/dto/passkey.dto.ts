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
 * Passkey login device info
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
 * Passkey registration verification DTO
 * The client submits this data after navigator.credentials.create()
 */
export class VerifyPasskeyRegistrationDto {
  @IsObject()
  response!: RegistrationResponseJSON;

  @IsOptional()
  @IsString()
  name?: string;
}

/**
 * Passkey login initiation DTO
 * Device info can optionally be provided
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
 * Passkey login verification DTO
 * The client submits this data after navigator.credentials.get()
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
 * Passkey two-factor authentication toggle DTO
 */
export class TogglePasskeyTfaDto {
  @IsBoolean()
  enabled!: boolean;
}
