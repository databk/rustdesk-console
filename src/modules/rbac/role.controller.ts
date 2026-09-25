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
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  RequirePermission,
  RequireSuperAdmin,
} from './decorators/require-permission.decorator';
import { CreateRoleDto, RoleQueryDto, UpdateRoleDto } from './dto/role.dto';
import { RoleService } from './services/role.service';
import { SkipConsoleAudit } from './decorators/skip-console-audit.decorator';

@Controller('roles')
@SkipConsoleAudit()
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @RequirePermission('roles.view')
  list(@Query() query: RoleQueryDto) {
    return this.roleService.listRoles(query);
  }

  @Get(':guid')
  @RequirePermission('roles.view')
  get(@Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string) {
    return this.roleService.getRole(guid);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequireSuperAdmin()
  create(@Body() dto: CreateRoleDto, @CurrentUser('id') actorGuid: string) {
    return this.roleService.createRole(dto, actorGuid);
  }

  @Get(':guid/protection-impact')
  @RequireSuperAdmin()
  impact(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @CurrentUser('id') actorGuid: string,
  ) {
    return this.roleService.getProtectionImpact(guid, actorGuid);
  }

  @Patch(':guid')
  @HttpCode(HttpStatus.OK)
  @RequireSuperAdmin()
  update(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser('id') actorGuid: string,
  ) {
    return this.roleService.updateRole(guid, dto, actorGuid);
  }

  @Delete(':guid')
  @HttpCode(HttpStatus.OK)
  @RequireSuperAdmin()
  async remove(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @CurrentUser('id') actorGuid: string,
  ) {
    await this.roleService.deleteRole(guid, actorGuid);
    return { message: '角色已删除' };
  }
}
