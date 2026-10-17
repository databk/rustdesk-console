import { IsOptional, IsString } from 'class-validator';

/**
 * Update server management settings DTO
 * All fields are optional; only the provided fields are updated
 * Cross-field validation (token length when url is set) is performed by
 * ServerManagementSettingsService
 */
export class UpdateServerManagementSettingsDto {
  /** hbbs management API HTTP(S) origin; empty disables server management */
  @IsString()
  @IsOptional()
  url?: string;

  @IsString()
  @IsOptional()
  token?: string;

  @IsString()
  @IsOptional()
  nodeId?: string;

  @IsString()
  @IsOptional()
  nodeName?: string;
}
