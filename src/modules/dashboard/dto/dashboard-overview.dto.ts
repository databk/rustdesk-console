export class DashboardDataDto {
  users: {
    total: number;
    admin: number;
    normal: number;
    newToday: number;
  };

  devices: {
    total: number;
    online: number;
    offline: number;
  };

  connections: {
    today: number;
    successCount: number;
    failureCount: number;
  };

  files: {
    transferredToday: number;
    uploadToday: number;
    downloadToday: number;
  };

  counts: {
    addressBooks: number;
    groups: number;
    roles: number;
    strategies: number;
  };

  systemStatus: {
    cpu: number | null;
    memory: number | null;
    disk: number | null;
    uptime: number | null;
  };
}

export class DashboardTrendsDto {
  connectionTrend?: Array<{
    date: string;
    count: number;
  }>;

  userActiveTrend?: Array<{
    date: string;
    newUsers: number;
  }>;

  alarmTrend?: Array<{
    date: string;
    info: number;
  }>;
}
