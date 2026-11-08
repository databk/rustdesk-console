import {
  IsIn,
  IsOptional,
  IsObject,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CustomClientCustomDto {
  @IsOptional()
  @IsString()
  'app-name'?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  salt?: string;

  @IsOptional()
  @IsIn(['incoming', 'outgoing', 'both'])
  'conn-type'?: string;

  @IsOptional()
  @IsIn(['Y', 'N'])
  'disable-installation'?: string;

  @IsOptional()
  @IsIn(['Y', 'N'])
  'disable-settings'?: string;

  @IsOptional()
  @IsIn(['Y', 'N'])
  'disable-account'?: string;

  @IsOptional()
  @IsIn(['Y', 'N'])
  'disable-ab'?: string;

  @IsOptional()
  @IsIn(['Y', 'N'])
  'disable-tcp-listen'?: string;

  @IsOptional()
  @IsObject()
  'override-settings'?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  'default-settings'?: Record<string, unknown>;
}

export class SubmitBuildDto {
  @IsIn(['windows', 'linux', 'macos', 'android', 'ios', 'all'])
  os: string;

  @IsOptional()
  @IsIn(['x86_64', 'aarch64', 'x86', 'armv7', 'universal'])
  arch?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CustomClientCustomDto)
  custom?: CustomClientCustomDto;
}

export interface SubmitBuildResponse {
  uuid: string;
  status: string;
  message: string;
}

export interface BuildProgressStep {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface BuildProgressJob {
  name: string;
  status: string;
  conclusion: string | null;
  steps: BuildProgressStep[];
}

export interface BuildProgressResponse {
  runId: string | null;
  runStatus: string;
  runConclusion: string | null;
  jobs: BuildProgressJob[];
}
