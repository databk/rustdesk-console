import { IsString, IsIn } from 'class-validator';

/** 提交构建请求 DTO */
export class NexusGenerateDto {
  @IsIn(['windows', 'linux', 'macos'])
  os: string;

  @IsIn(['x64', 'arm64'])
  arch: string;

  @IsString()
  app_name: string;
}

/** 构建请求响应 */
export interface NexusGenerateResponse {
  request_id: string;
  status: string;
  message: string;
}

/** 构建状态响应 */
export interface NexusBuildStatusResponse {
  request_id: string;
  status: 'pending' | 'building' | 'completed' | 'failed' | 'cancelled';
  download_url?: string;
  message?: string;
}
