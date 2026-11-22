import {
  IsOptional,
  IsString,
  IsNotEmpty,
  Matches,
  MinLength,
  MaxLength,
  IsIn,
} from 'class-validator';

/**
 * CompleteSetupDto
 * DTO for the setup wizard completion request.
 *
 * - serverUrl: required, the server origin (http/https only)
 * - serverPublicKey: optional, Ed25519 public key from Server Pro hbbs
 *   (Base64-encoded 32 bytes; ≤ 64 chars of Base64)
 * - adminUsername: required, the administrator account username (2-64 chars)
 * - adminPassword: required, the administrator account password (min 6 chars)
 */
export class CompleteSetupDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^https?:\/\/[^\s?#]+$/, {
    message: 'serverUrl must be an http(s) origin without path/query/fragment',
  })
  @MaxLength(253) // DNS FQDN max + scheme overhead (generous cap)
  serverUrl!: string;

  @IsOptional()
  @IsString()
  // Ed25519 public key Base64 encoded = 44 chars with padding, max 64 is safe
  @MaxLength(128)
  serverPublicKey?: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9_.@-]+$/, {
    message: 'adminUsername may contain letters, numbers, dots, underscores, hyphens and @',
  })
  @MinLength(2)
  @MaxLength(64)
  adminUsername!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: 'adminPassword must be at least 6 characters' })
  @MaxLength(128, { message: 'adminPassword must be at most 128 characters' })
  adminPassword!: string;
}
