import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

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
  site: SiteSettingsDto;
  webauthn: WebAuthnSettingsDto;
}

export class UpdateGeneralSettingsDto {
  @IsBoolean()
  watermarkEnabled: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => SiteSettingsDto)
  site?: SiteSettingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => WebAuthnSettingsDto)
  webauthn?: WebAuthnSettingsDto;
}
