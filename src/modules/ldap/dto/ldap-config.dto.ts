import {
  IsString,
  IsBoolean,
  IsOptional,
  IsArray,
  IsNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * TLS configuration DTO
 * Only safe TLS options are allowed, preventing injection of dangerous properties such as rejectUnauthorized: false
 */
export class TlsOptionsDto {
  /** CA certificate (PEM-format string or Buffer) */
  @IsOptional()
  @IsString()
  ca?: string;

  /** Client certificate (PEM-format string) */
  @IsOptional()
  @IsString()
  cert?: string;

  /** Client private key (PEM-format string) */
  @IsOptional()
  @IsString()
  key?: string;

  /** Server Name Indication (SNI) */
  @IsOptional()
  @IsString()
  servername?: string;
}

/**
 * Update LDAP configuration DTO
 * All fields are optional; only the provided fields are updated
 */
export class UpdateLdapConfigDto {
  /** List of LDAP server URLs (multiple servers supported for failover), e.g. ldaps://ad1.example.com:636 */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  urls?: string[];

  /** Service account bind DN, e.g. CN=svc-ldap,OU=ServiceAccounts,DC=example,DC=com */
  @IsString()
  @IsOptional()
  bindDN?: string;

  /** Service account password */
  @IsString()
  @IsOptional()
  bindCredentials?: string;

  /** Search base DN, e.g. DC=example,DC=com */
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  searchBase?: string;

  /** Search filter, e.g. (sAMAccountName={{username}}) */
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  searchFilter?: string;

  /** List of user attributes to read */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  searchAttributes?: string[];

  /** Group search base DN */
  @IsString()
  @IsOptional()
  groupSearchBase?: string;

  /** Group search filter, e.g. (member={{dn}}) */
  @IsString()
  @IsOptional()
  groupSearchFilter?: string;

  /** List of LDAP group DNs mapped to administrators */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  adminGroups?: string[];

  /** TLS configuration (only the safe options ca/cert/key/servername are allowed) */
  @ValidateNested()
  @Type(() => TlsOptionsDto)
  @IsOptional()
  tlsOptions?: TlsOptionsDto;

  /** Whether LDAP authentication is enabled */
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

/**
 * Test LDAP connection DTO
 * A configuration may optionally be provided for testing; if omitted, the currently active configuration is tested
 */
export class TestLdapConfigDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  urls?: string[];

  @IsString()
  @IsOptional()
  bindDN?: string;

  @IsString()
  @IsOptional()
  bindCredentials?: string;

  @IsString()
  @IsOptional()
  searchBase?: string;

  @IsString()
  @IsOptional()
  searchFilter?: string;
}
