import {
  IsString,
  IsIn,
  IsOptional,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Customization configuration object */
export class NexusCustomDto {
  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  salt?: string;

  @IsOptional()
  @IsIn(['incoming', 'outgoing', 'both'])
  'conn-type'?: string;

  @IsOptional()
  @IsIn(['Y', 'N'])
  'disable-installation'?: string;

  @IsOptional()
  @IsIn(['Y', 'N'])
  'disable-settings'?: string;

  @IsOptional()
  @IsIn(['Y', 'N'])
  'disable-account'?: string;

  @IsOptional()
  @IsIn(['Y', 'N'])
  'disable-ab'?: string;

  @IsOptional()
  @IsIn(['Y', 'N'])
  'disable-tcp-listen'?: string;

  @IsOptional()
  @IsString()
  'app-name'?: string;

  @IsOptional()
  @IsObject()
  'override-settings'?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  'default-settings'?: Record<string, unknown>;
}

/** Submit build request DTO */
export class NexusGenerateDto {
  @IsIn(['windows'])
  os: string;

  @IsIn(['x86_64', 'aarch64', 'x86'])
  arch: string;

  @ValidateNested()
  @Type(() => NexusCustomDto)
  custom: NexusCustomDto;
}

/** Build request response */
export interface NexusGenerateResponse {
  uuid: string;
  status: string;
  message: string;
}

/** Build status response */
export interface NexusBuildStatusResponse {
  uuid: string;
  status: 'pending' | 'building' | 'completed' | 'failed' | 'cancelled';
  files?: string[];
  message?: string;
}
