import { Controller, Get, Query } from '@nestjs/common';
import { AdminUserService } from './admin-user.service';
import { AdminUserQueryDto } from './dto/admin-user.dto';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';

@Controller('admin/users')
export class AdminUserController {
  constructor(private readonly adminUserService: AdminUserService) {}

  @Get()
  @RequirePermission('users.view')
  async getAdminUsers(@Query() query: AdminUserQueryDto) {
    return this.adminUserService.getAdminUsers(query);
  }
}
