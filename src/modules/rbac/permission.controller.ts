import { Controller, Get } from '@nestjs/common';
import { PermissionService } from './services/permission.service';
import { RequirePermissions } from './decorators/require-permissions.decorator';

/**
 * 权限目录控制器（只读）
 */
@Controller('permissions')
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  @Get()
  @RequirePermissions('role:read')
  async list() {
    const permissions = await this.permissionService.listPermissions();
    return {
      data: permissions.map((p) => ({
        guid: p.guid,
        code: p.code,
        name: p.name,
        module: p.module,
        description: p.description,
        created_at: p.createdAt,
      })),
    };
  }
}
