import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsUrl,
  IsEnum,
} from 'class-validator';
import { OidcProviderType } from '../entities/oidc-provider.entity';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

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

export class OidcProviderQueryDto extends PaginationQueryDto {}
