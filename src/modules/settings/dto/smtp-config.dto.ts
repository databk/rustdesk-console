import {
  IsString,
  IsNumber,
  IsBoolean,
  IsNotEmpty,
  Min,
  Max,
  IsOptional,
} from 'class-validator';

/**
 * Create SMTP configuration DTO
 */
export class CreateSmtpConfigDto {
  @IsString()
  @IsNotEmpty()
  host: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  port: number;

  @IsBoolean()
  @IsOptional()
  secure?: boolean;

  @IsString()
  @IsOptional()
  user?: string;

  @IsString()
  @IsOptional()
  pass?: string;

  @IsString()
  @IsNotEmpty()
  from: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

/**
 * Update SMTP configuration DTO
 * All fields are optional; only the provided fields are updated
 */
export class UpdateSmtpConfigDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  host?: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  @IsOptional()
  port?: number;

  @IsBoolean()
  @IsOptional()
  secure?: boolean;

  @IsString()
  @IsOptional()
  user?: string;

  @IsString()
  @IsOptional()
  pass?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  from?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

/**
 * Test SMTP connection DTO
 * A configuration may optionally be provided for testing; if omitted, the currently active configuration is tested
 */
export class TestSmtpConfigDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  host?: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  @IsOptional()
  port?: number;

  @IsBoolean()
  @IsOptional()
  secure?: boolean;

  @IsString()
  @IsOptional()
  user?: string;

  @IsString()
  @IsOptional()
  pass?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  from?: string;
}
