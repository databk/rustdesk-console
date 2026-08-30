/**
 * Backend-owned permission catalog. Permission identifiers are intentionally
 * fixed: roles may compose these values, but callers cannot create new ones.
 */
export type PermissionCode =
  | 'users.view'
  | 'users.create'
  | 'users.edit'
  | 'users.status'
  | 'users.delete'
  | 'users.security'
  | 'users.force_logout'
  | 'user_groups.view'
  | 'user_groups.create'
  | 'user_groups.edit'
  | 'user_groups.delete'
  | 'user_groups.membership'
  | 'devices.view'
  | 'devices.edit'
  | 'devices.status'
  | 'devices.delete'
  | 'devices.disconnect'
  | 'address_books.view'
  | 'address_books.edit'
  | 'address_books.share'
  | 'strategies.view'
  | 'strategies.create'
  | 'strategies.edit'
  | 'strategies.delete'
  | 'strategies.assign'
  | 'audit.view';

export interface PermissionDefinition {
  code: PermissionCode;
  resource: string;
  action: string;
  name: string;
  description: string;
  scope: 'global' | 'device_group';
}

const definition = (
  code: PermissionCode,
  resource: string,
  action: string,
  name: string,
  scope: PermissionDefinition['scope'] = 'global',
): PermissionDefinition => ({
  code,
  resource,
  action,
  name,
  description: `${name} (${code})`,
  scope,
});

export const PERMISSION_CATALOG: readonly PermissionDefinition[] = [
  definition('users.view', 'users', 'view', 'View users'),
  definition('users.create', 'users', 'create', 'Create users'),
  definition('users.edit', 'users', 'edit', 'Edit users'),
  definition('users.status', 'users', 'status', 'Change user status'),
  definition('users.delete', 'users', 'delete', 'Delete users'),
  definition('users.security', 'users', 'security', 'Manage user security'),
  definition(
    'users.force_logout',
    'users',
    'force_logout',
    'Force user logout',
  ),
  definition('user_groups.view', 'user_groups', 'view', 'View user groups'),
  definition(
    'user_groups.create',
    'user_groups',
    'create',
    'Create user groups',
  ),
  definition('user_groups.edit', 'user_groups', 'edit', 'Edit user groups'),
  definition(
    'user_groups.delete',
    'user_groups',
    'delete',
    'Delete user groups',
  ),
  definition(
    'user_groups.membership',
    'user_groups',
    'membership',
    'Manage user group membership',
  ),
  definition('devices.view', 'devices', 'view', 'View devices', 'device_group'),
  definition(
    'devices.edit',
    'devices',
    'edit',
    'Edit device metadata',
    'device_group',
  ),
  definition(
    'devices.status',
    'devices',
    'status',
    'Change device status',
    'device_group',
  ),
  definition(
    'devices.delete',
    'devices',
    'delete',
    'Delete devices',
    'device_group',
  ),
  definition(
    'devices.disconnect',
    'devices',
    'disconnect',
    'Disconnect devices',
    'device_group',
  ),
  definition(
    'address_books.view',
    'address_books',
    'view',
    'View address books',
  ),
  definition(
    'address_books.edit',
    'address_books',
    'edit',
    'Edit address books',
  ),
  definition(
    'address_books.share',
    'address_books',
    'share',
    'Share address books',
  ),
  definition('strategies.view', 'strategies', 'view', 'View strategies'),
  definition('strategies.create', 'strategies', 'create', 'Create strategies'),
  definition('strategies.edit', 'strategies', 'edit', 'Edit strategies'),
  definition('strategies.delete', 'strategies', 'delete', 'Delete strategies'),
  definition(
    'strategies.assign',
    'strategies',
    'assign',
    'Assign strategies',
    'device_group',
  ),
  definition('audit.view', 'audit', 'view', 'View audit data'),
];

export const PERMISSION_CODES = PERMISSION_CATALOG.map((item) => item.code);

export const DEVICE_SCOPED_PERMISSION_CODES = new Set<PermissionCode>([
  'devices.view',
  'devices.edit',
  'devices.status',
  'devices.delete',
  'devices.disconnect',
  'strategies.assign',
]);

export const isKnownPermissionCode = (code: string): code is PermissionCode =>
  PERMISSION_CODES.includes(code as PermissionCode);
