/**
 * 更新通道
 */
export enum UpdateChannel {
  STABLE = 'stable',
  NIGHTLY = 'nightly',
}

/**
 * 更新检查 API 请求体
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
  features: {
    address_book: {
      total: number;
      personal: number;
      shared: number;
      peers: number;
      tags: number;
      rules: number;
    };
    strategy: {
      total: number;
    };
    user_group: {
      total: number;
    };
    auth: {
      passkey_credentials: number;
      active_tokens: number;
      revoked_tokens: number;
      pending_invitations: number;
      used_invitations: number;
    };
    oidc: {
      providers: number;
      enabled_providers: number;
    };
    nexus: {
      builds_total: number;
      builds_by_status: {
        pending: number;
        building: number;
        completed: number;
        failed: number;
        cancelled: number;
      };
      tokens: number;
    };
    audit: {
      file_transfers_7d: number;
      alarms_7d: number;
    };
    active_connections: {
      current: number;
    };
    device_group_permissions: {
      total: number;
    };
    sysinfo: {
      total: number;
    };
  };
}

/**
 * 更新检查 API 响应体 - 有更新
 */
export interface UpdateCheckComponentResult {
  has_update: true;
  version: string;
  release_url: string;
  release_note: string;
  published_at: string;
}

/**
 * 更新检查 API 响应体 - 无更新
 */
export interface UpdateCheckNoUpdateResult {
  has_update: false;
}

/**
 * 更新检查 API 响应体
 */
export interface UpdateCheckResponse {
  backend: UpdateCheckComponentResult | UpdateCheckNoUpdateResult;
  frontend: UpdateCheckComponentResult | UpdateCheckNoUpdateResult;
}
