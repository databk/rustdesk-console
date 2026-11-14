import { IsOptional, IsString, IsBoolean, Matches } from 'class-validator';

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
  @IsBoolean()
  regenerateSigningKey?: boolean;
}

export interface CustomClientSettingsResponse {
  githubToken: string;
  generatorRepo: string;
  generatorRef: string;
  signingPublicKey: string;
}
