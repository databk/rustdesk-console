import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
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

  @IsString()
  @IsOptional()
  icon?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
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

  @IsString()
  @IsOptional()
  icon?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

export class ToggleOidcProviderDto {
  @IsBoolean()
  @IsNotEmpty()
  enabled: boolean;
}

export class OidcProviderQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  current?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
