import { IsString, IsOptional, IsUrl, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Device info
 */
export class DeviceInfoDto {
  @IsString()
  os: string; // Operating system: Linux, Windows, Android...

  @IsString()
  type: string; // Type: browser or client

  @IsString()
  name: string; // Device name or browser info
}

/**
 * OIDC authorization request
 */
export class OidcAuthRequestDto {
  @IsString()
  op: string; // OIDC provider identifier, e.g. oidc/google

  @IsOptional()
  @IsString()
  id?: string; // device ID (client-only field)

  @IsOptional()
  @IsString()
  uuid?: string; // Device UUID (client-only field)

  @ValidateNested()
  @Type(() => DeviceInfoDto)
  deviceInfo: DeviceInfoDto; // Device info (required)

  @IsOptional()
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
  })
  callbackUrl?: string; // Web frontend callback URL (optional)
}
