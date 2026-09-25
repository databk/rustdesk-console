export class DashboardDataDto {
  users: {
    total: number;
    active: number;
    newToday: number;
  };

  devices: {
    total: number;
    online: number;
    offline: number;
    groups: number;
  };

  connections: {
    today: number;
    successRate: number;
    avgDuration: number;
  };

  alarms: {
    total: number;
    today: number;
  };

  files: {
    transferredToday: number;
    totalSize: string;
    uploadCount: number;
    downloadCount: number;
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
    avgDuration: number;
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
