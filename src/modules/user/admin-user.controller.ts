import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminUserService } from './admin-user.service';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AdminUserQueryDto } from './dto/admin-user.dto';

@Controller('admin/users')
@UseGuards(AdminGuard)
export class AdminUserController {
  constructor(private readonly adminUserService: AdminUserService) {}

  @Get()
  async getAdminUsers(@Query() query: AdminUserQueryDto) {
    return this.adminUserService.getAdminUsers(query);
  }

  @Get(':guid')
  async getAdminUser(@Param('guid') guid: string) {
    return this.adminUserService.getAdminUser(guid);
  }
}
