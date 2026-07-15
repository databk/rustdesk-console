import {
  IsString,
  IsIn,
  IsOptional,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

/** 定制配置对象 */
export class NexusCustomDto {
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
  @IsString()
  'app-name'?: string;

  @IsOptional()
  @IsObject()
  'override-settings'?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  'default-settings'?: Record<string, unknown>;
}

/** 提交构建请求 DTO */
export class NexusGenerateDto {
  @IsIn(['windows'])
  os: string;

  @IsIn(['x86_64', 'aarch64', 'x86'])
  arch: string;

  @ValidateNested()
  @Type(() => NexusCustomDto)
  custom: NexusCustomDto;
}

/** 构建请求响应 */
export interface NexusGenerateResponse {
  uuid: string;
  status: string;
  message: string;
}

/** 构建状态响应 */
export interface NexusBuildStatusResponse {
  uuid: string;
  status: 'pending' | 'building' | 'completed' | 'failed' | 'cancelled';
  files?: string[];
  message?: string;
}
