import {
  IsIn,
  IsOptional,
  IsObject,
  IsString,
  IsArray,
  Matches,
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
  @Matches(/^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/, {
    message:
      'version must be a RustDesk release tag, e.g. 1.5.3 (letters, digits, dot, dash, underscore)',
  })
  version?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CustomClientCustomDto)
  custom?: CustomClientCustomDto;
}

export interface SubmitBuildResponse {
  uuid: string;
  status: string;
}

export interface RustdeskReleaseInfo {
  tag: string;
  name: string;
  publishedAt: string;
  prerelease: boolean;
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
  runId: number | null;
  runStatus: string;
  runConclusion: string | null;
  percent: number;
  totalSteps: number;
  completedSteps: number;
  currentJob: string | null;
  currentStep: string | null;
  jobs: BuildProgressJob[];
}

export class BuildFileDto {
  @IsString()
  name: string;

  @IsString()
  url: string;
}

export class UploadFilesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuildFileDto)
  files: BuildFileDto[];
}
