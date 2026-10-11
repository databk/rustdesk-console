import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateServerNodeDto {
  @IsEnum(['hbbs', 'hbbr'])
  role: 'hbbs' | 'hbbr';

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  url: string;

  @IsString()
  @MinLength(32)
  managementToken: string;
}

export class UpdateServerNodeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  url?: string;

  @IsOptional()
  @IsString()
  @MinLength(32)
  managementToken?: string;
}