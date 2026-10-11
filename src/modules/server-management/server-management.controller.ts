import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { SkipConsoleAudit } from '../rbac/decorators/skip-console-audit.decorator';
import { CreateServerNodeDto, UpdateServerNodeDto } from './server-node.dto';
import { ServerBansDto, ServerConfigDto } from './server-management.dto';
import { ServerManagementService } from './server-management.service';

@Controller('servers')
@SkipConsoleAudit()
export class ServerManagementController {
  constructor(private readonly service: ServerManagementService) {}

  @Get()
  @RequirePermission('servers.view')
  list() {
    return this.service.list();
  }

  @Post()
  @RequirePermission('servers.manage')
  create(@Body() dto: CreateServerNodeDto) {
    return this.service.create(dto.role, dto.name, dto.url, dto.managementToken);
  }

  @Patch(':id')
  @RequirePermission('servers.manage')
  update(@Param('id') id: string, @Body() dto: UpdateServerNodeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('servers.manage')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Get(':id/peers')
  @RequirePermission('servers.view')
  peers(@Param('id') id: string) {
    return this.service.getPeers(id);
  }

  @Get(':id/sessions')
  @RequirePermission('servers.view')
  sessions(@Param('id') id: string) {
    return this.service.getSessions(id);
  }

  @Delete(':id/sessions/:uuid')
  @RequirePermission('servers.disconnect')
  disconnect(
    @Param('id') id: string,
    @Param('uuid') uuid: string,
    @CurrentUser('id') actor: string,
  ) {
    return this.service.disconnectSession(actor, id, uuid);
  }

  @Get(':id/config')
  @RequirePermission('servers.config')
  config(@Param('id') id: string) {
    return this.service.getConfig(id);
  }

  @Put(':id/config')
  @RequirePermission('servers.config')
  saveConfig(
    @Param('id') id: string,
    @Body() dto: ServerConfigDto,
    @CurrentUser('id') actor: string,
  ) {
    return this.service.saveConfig(actor, id, dto);
  }

  @Get('bans')
  @RequirePermission('servers.ban')
  bans() {
    return this.service.getBans();
  }

  @Put('bans')
  @RequirePermission('servers.ban')
  saveBans(
    @Body() dto: ServerBansDto,
    @CurrentUser('id') actor: string,
  ) {
    return this.service.applyBans(actor, dto);
  }
}
