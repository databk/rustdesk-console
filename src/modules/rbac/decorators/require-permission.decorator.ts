import { SetMetadata } from '@nestjs/common';
import { PermissionCode } from '../constants/permission-catalog';

export const REQUIRE_PERMISSION_KEY = 'rbac:required_permissions';
export const REQUIRE_SUPER_ADMIN_KEY = 'rbac:super_admin';

export const RequirePermission = (...permissions: PermissionCode[]) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permissions);

export const RequireSuperAdmin = () =>
  SetMetadata(REQUIRE_SUPER_ADMIN_KEY, true);
