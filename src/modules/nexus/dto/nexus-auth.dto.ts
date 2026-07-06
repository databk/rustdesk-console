import { IsString, IsOptional } from 'class-validator';

/** 创建 Nexus 登录会话 DTO */
export class NexusLoginDto {
  @IsOptional()
  @IsString()
  callbackUrl?: string;
}

/** Nexus 登录会话响应 */
export interface NexusLoginResponse {
  login_id: string;
  auth_url: string;
  expires_in: number;
}

/** Nexus 登录状态响应 */
export interface NexusAuthStatusResponse {
  state: 'pending' | 'completed' | 'failed';
  nexus_username?: string;
  expires_in?: number;
  error?: string;
}

/** Nexus 绑定状态响应 */
export interface NexusBindStatusResponse {
  bound: boolean;
  nexus_username?: string;
  expired?: boolean;
}
