import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { UserRoleService } from './services/user-role.service';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { AssignUserRolesDto } from './dto/user-role.dto';

/**
 * 用户角色分配控制器
 * 路由前缀 /api/users（与既有 UserController 共存，仅占用 :guid/roles 子路径）
 */
@Controller('users')
export class UserRoleController {
  constructor(private readonly userRoleService: UserRoleService) {}

  @Get(':guid/roles')
  @RequirePermissions('user:role:assign')
  async getRoles(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
  ) {
    const data = await this.userRoleService.getUserRoles(guid);
    return { data };
  }

  @Put(':guid/roles')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user:role:assign')
  async assignRoles(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Body() dto: AssignUserRolesDto,
  ) {
    await this.userRoleService.assignUserRoles(guid, dto);
    return { message: '用户角色已更新' };
  }
}
