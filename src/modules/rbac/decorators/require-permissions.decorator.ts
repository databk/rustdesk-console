import { SetMetadata } from '@nestjs/common';

/** 元数据键：路由所需的权限码列表 */
export const REQUIRE_PERMISSIONS_KEY = 'require_permissions';

/**
 * 权限要求装饰器
 *
 * 标注的路由要求当前用户具备全部给定权限码（AND 语义）。
 * `isAdmin=true` 的超管自动放行（快速通道）。
 * 未标注本装饰器的路由仅需通过全局 JWT 认证即可访问。
 *
 * @example
 * @RequirePermissions('user:write')
 * @RequirePermissions('role:write', 'user:role:assign') // 需同时具备
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, permissions);
