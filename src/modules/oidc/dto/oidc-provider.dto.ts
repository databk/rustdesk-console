import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsInt,
  Min,
  IsUrl,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OidcProviderType } from '../entities/oidc-provider.entity';

export class CreateOidcProviderDto {
  @IsEnum(OidcProviderType)
  @IsOptional()
  type?: OidcProviderType;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false, require_protocol: true })
  issuer: string;

  @IsString()
  @IsNotEmpty()
  clientId: string;

  @IsString()
  @IsOptional()
  clientSecret?: string;

  @IsString()
  @IsOptional()
  scope?: string;

  @IsString()
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  authorizationEndpoint?: string;

  @IsString()
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  tokenEndpoint?: string;

  @IsString()
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  userinfoEndpoint?: string;

  @IsString()
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  jwksUri?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsNumber()
  @IsOptional()
  priority?: number;
}

export class UpdateOidcProviderDto {
  @IsEnum(OidcProviderType)
  @IsOptional()
  type?: OidcProviderType;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  issuer?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  clientId?: string;

  @IsString()
  @IsOptional()
  clientSecret?: string;

  @IsString()
  @IsOptional()
  scope?: string;

  @IsString()
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  authorizationEndpoint?: string;

  @IsString()
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  tokenEndpoint?: string;

  @IsString()
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  userinfoEndpoint?: string;

  @IsString()
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  jwksUri?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsNumber()
  @IsOptional()
  priority?: number;
}

export class ToggleOidcProviderDto {
  @IsBoolean()
  @IsNotEmpty()
  enabled: boolean;
}

export class OidcProviderQueryDto {
  @IsNumber()
  @Min(1)
  @IsInt()
  @Type(() => Number)
  current: number;

  @IsNumber()
  @Min(1)
  @IsInt()
  @Type(() => Number)
  pageSize: number;

  @IsString()
  @IsOptional()
  name?: string;
}
