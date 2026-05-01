/**
 * Dashboard 总览数据响应 DTO
 */
export class DashboardOverviewDto {
  // 用户统计
  users: {
    total: number;
    active: number;
    online: number;
    newToday: number;
  };

  // 设备统计
  devices: {
    total: number;
    online: number;
    offline: number;
    groups: number;
  };

  // 连接统计
  connections: {
    active: number;
    today: number;
    avgDuration: number;
  };

  // 审计统计
  audits: {
    alarms: number;
    unreadAlarms: number;
    criticalAlarms: number;
  };

  // 文件传输统计
  files: {
    transferred: number;
    totalSize: string;
  };
}

/**
 * 用户分布统计 DTO
 */
export class UserDistributionDto {
  byRole: {
    admin: number;
    user: number;
  };

  byStatus: {
    active: number;
    inactive: number;
    disabled: number;
    unverified: number;
  };
}

/**
 * 设备分布统计 DTO
 */
export class DeviceDistributionDto {
  byGroup: {
    groupId: string;
    groupName: string;
    count: number;
  }[];

  byStatus: {
    online: number;
    offline: number;
  };
}

/**
 * 连接分析统计 DTO
 */
export class ConnectionAnalysisDto {
  avgDuration: number;
  totalDuration: number;
  successRate: number;
  failureCount: number;
}

/**
 * 文件传输统计 DTO
 */
export class FileTransferDto {
  totalFiles: number;
  totalSize: number;
  uploadCount: number;
  downloadCount: number;
}

/**
 * Dashboard 统计数据响应 DTO
 */
export class DashboardStatisticsDto {
  userDistribution: UserDistributionDto;
  deviceDistribution: DeviceDistributionDto;
  connectionAnalysis: ConnectionAnalysisDto;
  fileTransfer: FileTransferDto;
}

/**
 * 趋势数据点 DTO
 */
export class TrendDataPointDto {
  date: string;
  count: number;
  avgDuration?: number;
}

/**
 * 用户活跃趋势数据点 DTO
 */
export class UserActiveTrendDto {
  date: string;
  newUsers: number;
  activeUsers: number;
}

/**
 * 设备在线趋势数据点 DTO
 */
export class DeviceOnlineTrendDto {
  time: string;
  online: number;
  offline: number;
}

/**
 * 告警趋势数据点 DTO
 */
export class AlarmTrendDto {
  date: string;
  critical: number;
  warning: number;
  info: number;
}

/**
 * Dashboard 趋势数据响应 DTO
 */
export class DashboardTrendsDto {
  connectionTrend?: TrendDataPointDto[];
  userActiveTrend?: UserActiveTrendDto[];
  deviceOnlineTrend?: DeviceOnlineTrendDto[];
  alarmTrend?: AlarmTrendDto[];
}

/**
 * 活跃连接 DTO
 */
export class ActiveConnectionDto {
  id: string;
  userId: string;
  userName: string;
  deviceId: string;
  deviceName: string;
  startTime: Date;
  duration: number;
}

/**
 * 最近事件 DTO
 */
export class RecentEventDto {
  type: 'connection' | 'file' | 'alarm';
  action: string;
  user: string;
  target: string;
  timestamp: Date;
  status: 'success' | 'failed' | 'warning';
}

/**
 * 系统状态 DTO
 */
export class SystemStatusDto {
  cpu: number;
  memory: number;
  disk: number;
  uptime: number;
}

/**
 * Dashboard 实时数据响应 DTO
 */
export class DashboardRealtimeDto {
  activeConnections: ActiveConnectionDto[];
  recentEvents: RecentEventDto[];
  systemStatus: SystemStatusDto;
}
