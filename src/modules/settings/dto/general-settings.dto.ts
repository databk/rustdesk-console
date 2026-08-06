import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

const LANGUAGE_KEY_PATTERN = /^[a-z]{2}-[A-Z]{2}$/;

export class SiteSettingsDto {
  @IsOptional()
  @IsString()
  frontendUrl?: string;

  @IsOptional()
  @IsString()
  backendUrl?: string;
}

export class WebAuthnSettingsDto {
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  rpName?: string;
}

export class GeneralSettingsDto {
  watermarkEnabled: boolean;
  defaultLanguage: string;
  site: SiteSettingsDto;
  webauthn: WebAuthnSettingsDto;
}

export class UpdateGeneralSettingsDto {
  @IsBoolean()
  watermarkEnabled: boolean;

  @IsOptional()
  @Matches(LANGUAGE_KEY_PATTERN, {
    message: 'defaultLanguage must be a BCP 47 region tag like en-US, pt-BR, zh-CN',
  })
  defaultLanguage?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SiteSettingsDto)
  site?: SiteSettingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => WebAuthnSettingsDto)
  webauthn?: WebAuthnSettingsDto;
}
