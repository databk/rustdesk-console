/**
 * 权限目录与内置角色定义
 *
 * 权限码命名规范：`模块:动作`，动作统一为 `read` / `write`
 * （write 涵盖 create/update/delete/assign）。
 *
 * 权限目录为代码常量，应用启动时 upsert 入库，禁止通过 API 增删。
 * 新增端点必须在此登记对应权限码。
 */

export interface PermissionDef {
  code: string;
  name: string;
  module: string;
  description: string;
}

export interface BuiltInRoleDef {
  code: string;
  name: string;
  description: string;
  /** 权限码数组；admin 使用 ALL_PERMISSION_CODES 通配 */
  permissions: string[];
}

/**
 * 权限目录
 */
export const PERMISSION_CATALOG: PermissionDef[] = [
  // dashboard
  {
    code: 'dashboard:read',
    name: '仪表盘查看',
    module: 'dashboard',
    description: '查看仪表盘统计与趋势',
  },
  // user
  {
    code: 'user:read',
    name: '用户查看',
    module: 'user',
    description: '查看用户列表与详情',
  },
  {
    code: 'user:write',
    name: '用户管理',
    module: 'user',
    description: '创建/更新/删除/启停/邀请/改密/强制下线用户',
  },
  {
    code: 'user:role:assign',
    name: '用户角色分配',
    module: 'user',
    description: '给用户分配角色',
  },
  // user-group
  {
    code: 'user-group:read',
    name: '用户组查看',
    module: 'user-group',
    description: '查看用户组与成员',
  },
  {
    code: 'user-group:write',
    name: '用户组管理',
    module: 'user-group',
    description: '用户组 CRUD 与成员迁移',
  },
  // role
  {
    code: 'role:read',
    name: '角色查看',
    module: 'role',
    description: '查看角色与权限目录',
  },
  {
    code: 'role:write',
    name: '角色管理',
    module: 'role',
    description: '自定义角色 CRUD 与角色权限分配',
  },
  // device-group
  {
    code: 'device-group:read',
    name: '设备组查看',
    module: 'device-group',
    description: '查看设备组与设备',
  },
  {
    code: 'device-group:write',
    name: '设备组管理',
    module: 'device-group',
    description: '设备组 CRUD/设备启停/强制断开/权限分配',
  },
  // address-book
  {
    code: 'address-book:read',
    name: '地址簿查看',
    module: 'address-book',
    description: '查看全部地址簿（个人地址簿所有者权限不走 RBAC）',
  },
  {
    code: 'address-book:write',
    name: '地址簿管理',
    module: 'address-book',
    description: '管理全部地址簿',
  },
  // strategy
  {
    code: 'strategy:read',
    name: '策略查看',
    module: 'strategy',
    description: '查看策略',
  },
  {
    code: 'strategy:write',
    name: '策略管理',
    module: 'strategy',
    description: '策略 CRUD 与分配',
  },
  // audit
  {
    code: 'audit:read',
    name: '审计查看',
    module: 'audit',
    description: '查看连接/文件/告警/控制台审计日志',
  },
  // heartbeat
  {
    code: 'heartbeat:read',
    name: '心跳监控查看',
    module: 'heartbeat',
    description: '查看活跃连接与心跳监控',
  },
  // sysinfo
  {
    code: 'sysinfo:read',
    name: '系统信息查看',
    module: 'sysinfo',
    description: '查看设备系统信息',
  },
  // settings
  {
    code: 'settings:read',
    name: '系统设置查看',
    module: 'settings',
    description: '查看系统设置（SMTP/general）',
  },
  {
    code: 'settings:write',
    name: '系统设置管理',
    module: 'settings',
    description: '修改系统设置',
  },
  // oidc
  {
    code: 'oidc:read',
    name: 'OIDC 查看',
    module: 'oidc',
    description: '查看 OIDC 提供商',
  },
  {
    code: 'oidc:write',
    name: 'OIDC 管理',
    module: 'oidc',
    description: 'OIDC 提供商 CRUD',
  },
  // ldap
  {
    code: 'ldap:read',
    name: 'LDAP 查看',
    module: 'ldap',
    description: '查看 LDAP 配置',
  },
  {
    code: 'ldap:write',
    name: 'LDAP 管理',
    module: 'ldap',
    description: '修改 LDAP 配置',
  },
  // nexus
  {
    code: 'nexus:read',
    name: 'Nexus 查看',
    module: 'nexus',
    description: '查看 Nexus 构建与令牌',
  },
  {
    code: 'nexus:write',
    name: 'Nexus 管理',
    module: 'nexus',
    description: '管理 Nexus 令牌',
  },
  // update-check
  {
    code: 'update-check:read',
    name: '更新检查查看',
    module: 'update-check',
    description: '查看版本更新检查结果',
  },
];

/** 全部权限码 */
export const ALL_PERMISSION_CODES: string[] = PERMISSION_CATALOG.map(
  (p) => p.code,
);

/** 全部只读权限码（用于 viewer 内置角色） */
export const READ_PERMISSION_CODES: string[] = PERMISSION_CATALOG.filter((p) =>
  p.code.endsWith(':read'),
).map((p) => p.code);

/**
 * 内置角色定义
 *
 * 内置角色不可删除，每次启动重写同步其角色-权限映射。
 */
export const BUILT_IN_ROLES: BuiltInRoleDef[] = [
  {
    code: 'admin',
    name: '管理员',
    description: '拥有全部权限（等同超管快速通道）',
    permissions: ALL_PERMISSION_CODES,
  },
  {
    code: 'operator',
    name: '运维',
    description: '负责设备/地址簿/策略/审计的日常运维，不含用户与系统配置管理',
    permissions: [
      'dashboard:read',
      'device-group:read',
      'device-group:write',
      'address-book:read',
      'address-book:write',
      'strategy:read',
      'strategy:write',
      'audit:read',
      'heartbeat:read',
      'sysinfo:read',
      'user:read',
      'user-group:read',
    ],
  },
  {
    code: 'viewer',
    name: '只读用户',
    description: '全模块只读',
    permissions: READ_PERMISSION_CODES,
  },
];

/** admin 角色代码 */
export const ADMIN_ROLE_CODE = 'admin';
