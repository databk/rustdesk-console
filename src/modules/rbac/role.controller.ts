import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireSuperAdmin } from './decorators/require-permission.decorator';
import {
  CreateRoleDto,
  ReplaceRolePermissionsDto,
  RoleQueryDto,
  UpdateRoleDto,
} from './dto/role.dto';
import { RoleService } from './services/role.service';

@Controller('roles')
@RequireSuperAdmin()
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  list(@Query() query: RoleQueryDto) {
    return this.roleService.listRoles(query);
  }

  @Get(':guid')
  get(@Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string) {
    return this.roleService.getRole(guid);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  create(@Body() dto: CreateRoleDto, @CurrentUser('id') actorGuid: string) {
    return this.roleService.createRole(dto, actorGuid);
  }

  @Patch(':guid')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser('id') actorGuid: string,
  ) {
    return this.roleService.updateRole(guid, dto, actorGuid);
  }

  @Delete(':guid')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @CurrentUser('id') actorGuid: string,
  ) {
    await this.roleService.deleteRole(guid, actorGuid);
    return { message: '角色已删除' };
  }

  @Put(':guid/permissions')
  @HttpCode(HttpStatus.OK)
  replacePermissions(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Body() body: ReplaceRolePermissionsDto,
    @CurrentUser('id') actorGuid: string,
  ) {
    return this.roleService.replaceRolePermissions(
      guid,
      body.permissions,
      actorGuid,
    );
  }
}
