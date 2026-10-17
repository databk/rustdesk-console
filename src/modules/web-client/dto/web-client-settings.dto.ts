import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * Update web client settings DTO
 * All fields are optional; only the provided fields are updated
 * Cross-field validation (required URLs and key when enabled) is
 * performed by WebClientSettingsService
 */
export class UpdateWebClientSettingsDto {
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsString()
  @IsOptional()
  idServerUrl?: string;

  @IsString()
  @IsOptional()
  relayServerUrl?: string;

  @IsString()
  @IsOptional()
  serverPublicKey?: string;

  @IsString()
  @IsOptional()
  allowedOrigin?: string;

  @IsString()
  @IsOptional()
  idUpstreamUrl?: string;

  @IsString()
  @IsOptional()
  relayUpstreamUrl?: string;
}
