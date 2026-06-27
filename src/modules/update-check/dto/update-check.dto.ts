import { IsString } from 'class-validator';

/**
 * 更新通道
 */
export enum UpdateChannel {
  STABLE = 'stable',
  NIGHTLY = 'nightly',
}

/**
 * 前端版本上报 DTO
 */
export class ReportFrontendVersionDto {
  @IsString()
  version: string;

  /**
   * 共享密钥，用于验证前端容器的身份
   * 前后端通过环境变量 SHARED_SECRET 配置相同的密钥
   */
  @IsString()
  secret: string;
}

/**
 * 第三方 API 请求体
 */
export interface UpdateCheckRequest {
  version: {
    backend: string;
    frontend: string;
  };
  deployment: {
    type: 'docker' | 'manual';
    channel: 'stable' | 'nightly';
    install_id: string;
  };
  system: {
    os: {
      platform: string;
      arch: string;
      dist: string;
      release: string;
      kernel: string;
      hostname: string;
      uptime: number;
    };
    cpu: {
      model: string;
      cores: number;
      speed: string;
      load: number;
    };
    memory: {
      total: number;
      used: number;
      active: number;
    };
    disk: {
      total: number;
      used: number;
    };
  };
  runtime: {
    node_version: string;
    process_uptime: number;
    process_memory: number;
  };
  database: {
    type: string;
    size: number;
  };
  statistics: {
    users: {
      total: number;
      admins: number;
      active_7d: number;
    };
    devices: {
      total: number;
      online: number;
      groups: number;
    };
    connections: {
      total_7d: number;
    };
  };
}

/**
 * 第三方 API 响应体 - 有更新
 */
export interface UpdateCheckComponentResult {
  has_update: true;
  version: string;
  release_url: string;
  release_note: string;
  published_at: string;
}

/**
 * 第三方 API 响应体 - 无更新
 */
export interface UpdateCheckNoUpdateResult {
  has_update: false;
}

/**
 * 第三方 API 响应体
 */
export interface UpdateCheckResponse {
  backend: UpdateCheckComponentResult | UpdateCheckNoUpdateResult;
  frontend: UpdateCheckComponentResult | UpdateCheckNoUpdateResult;
}
