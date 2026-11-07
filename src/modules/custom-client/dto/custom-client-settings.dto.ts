import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateCustomClientSettingsDto {
  @IsOptional()
  @IsString()
  githubToken?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/)
  generatorRepo?: string;

  @IsOptional()
  @IsString()
  generatorRef?: string;

  @IsOptional()
  @IsString()
  signingPublicKey?: string;

  @IsOptional()
  @IsString()
  signingPrivateKey?: string;
}

export interface CustomClientSettingsResponse {
  githubToken: string;
  generatorRepo: string;
  generatorRef: string;
  signingPublicKey: string;
  signingPrivateKey: string;
}
