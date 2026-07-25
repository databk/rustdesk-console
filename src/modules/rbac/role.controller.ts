import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RoleService } from './services/role.service';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import {
  CreateRoleDto,
  RoleQueryDto,
  UpdateRoleDto,
} from './dto/role.dto';
import { AssignRolePermissionsDto } from './dto/role-permission.dto';
import { Role } from './entities/role.entity';

/**
 * 角色管理控制器
 * 路由前缀 /api/roles
 */
@Controller('roles')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @RequirePermissions('role:read')
  async list(@Query() query: RoleQueryDto) {
    return this.roleService.listRoles(query);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('role:write')
  async create(@Body() dto: CreateRoleDto) {
    const role = await this.roleService.createRole(dto);
    return this.mapRole(role);
  }

  @Get(':guid')
  @RequirePermissions('role:read')
  async get(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
  ) {
    const role = await this.roleService.getRole(guid);
    const permissions = await this.roleService.getRolePermissions(guid);
    return { ...this.mapRole(role), permissions };
  }

  @Put(':guid')
  @RequirePermissions('role:write')
  async update(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Body() dto: UpdateRoleDto,
  ) {
    const role = await this.roleService.updateRole(guid, dto);
    return this.mapRole(role);
  }

  @Delete(':guid')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('role:write')
  async delete(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
  ) {
    await this.roleService.deleteRole(guid);
    return { message: '角色已删除' };
  }

  @Get(':guid/permissions')
  @RequirePermissions('role:read')
  async getPermissions(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
  ) {
    const data = await this.roleService.getRolePermissions(guid);
    return { data };
  }

  @Put(':guid/permissions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('role:write')
  async assignPermissions(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Body() dto: AssignRolePermissionsDto,
  ) {
    await this.roleService.assignRolePermissions(guid, dto.permission_codes);
    return { message: '角色权限已更新' };
  }

  private mapRole(role: Role) {
    return {
      guid: role.guid,
      name: role.name,
      code: role.code,
      description: role.description,
      is_built_in: role.isBuiltIn,
      created_at: role.createdAt,
      updated_at: role.updatedAt,
    };
  }
}
