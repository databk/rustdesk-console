/**
 * Update channel
 */
export enum UpdateChannel {
  STABLE = 'stable',
  NIGHTLY = 'nightly',
}

/**
 * Update check API request body
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
      groups: number;
    };
    devices: {
      total: number;
      online: number;
      groups: number;
      group_permissions: number;
    };
    connections: {
      active: number;
      audited_7d: number;
    };
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
    auth: {
      passkey_credentials: number;
      active_tokens: number;
      revoked_tokens: number;
      pending_invitations: number;
      used_invitations: number;
      oidc_providers: number;
      oidc_enabled_providers: number;
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
  };
}

/**
 * Update check API response body - update available
 */
export interface UpdateCheckComponentResult {
  has_update: true;
  version: string;
  release_url: string;
  release_note: string;
  published_at: string;
}

/**
 * Update check API response body - no update
 */
export interface UpdateCheckNoUpdateResult {
  has_update: false;
}

/**
 * Update check API response body
 */
export interface UpdateCheckResponse {
  backend: UpdateCheckComponentResult | UpdateCheckNoUpdateResult;
  frontend: UpdateCheckComponentResult | UpdateCheckNoUpdateResult;
}
