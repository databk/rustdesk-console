import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Header,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { SkipConsoleAudit } from '../rbac/decorators/skip-console-audit.decorator';
import {
  RustdeskService,
  ServerBansDto,
  ServerConfigDto,
  ServiceAction,
} from './server-management.dto';
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

  @Get('network/tcp')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('servers.view')
  localNetwork() {
    return this.service.networkSettings();
  }

  @Get(':node/network/tcp')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('servers.view')
  network(@Param('node') node: string) {
    return this.service.networkSettings(node);
  }

  @Get(':node/peers')
  @RequirePermission('servers.view')
  peers(@Param('node') node: string) {
    return this.service.peers(node);
  }

  @Get(':node/sessions')
  @RequirePermission('servers.view')
  sessions(@Param('node') node: string) {
    return this.service.sessions(node);
  }

  @Delete(':node/sessions/:uuid')
  @RequirePermission('servers.disconnect')
  disconnect(
    @Param('node') node: string,
    @Param('uuid') uuid: string,
    @CurrentUser('id') actor: string,
  ) {
    return this.service.disconnect(actor, node, uuid);
  }

  @Get(':node/services/:service/logs')
  @RequirePermission('servers.view')
  logs(
    @Param('node') node: string,
    @Param('service', new ParseEnumPipe(RustdeskService))
    service: RustdeskService,
    @Query('tail', new DefaultValuePipe(200), ParseIntPipe) tail: number,
  ) {
    return this.service.logs(node, service, tail);
  }

  @Get(':node/services/:service/config')
  @RequirePermission('servers.config')
  config(
    @Param('node') node: string,
    @Param('service', new ParseEnumPipe(RustdeskService))
    service: RustdeskService,
  ) {
    return this.service.config(node, service);
  }

  @Put(':node/services/:service/config')
  @RequirePermission('servers.config')
  saveConfig(
    @Param('node') node: string,
    @Param('service', new ParseEnumPipe(RustdeskService))
    service: RustdeskService,
    @Body() dto: ServerConfigDto,
    @CurrentUser('id') actor: string,
  ) {
    return this.service.saveConfig(actor, node, service, dto);
  }

  @Post(':node/services/:service/:action')
  @RequirePermission('servers.control')
  action(
    @Param('node') node: string,
    @Param('service', new ParseEnumPipe(RustdeskService))
    service: RustdeskService,
    @Param('action', new ParseEnumPipe(ServiceAction)) action: ServiceAction,
    @CurrentUser('id') actor: string,
  ) {
    return this.service.serviceAction(actor, node, service, action);
  }

  @Get(':node/bans')
  @RequirePermission('servers.ban')
  bans(@Param('node') node: string) {
    return this.service.bans(node);
  }

  @Put(':node/bans')
  @RequirePermission('servers.ban')
  saveBans(
    @Param('node') node: string,
    @Body() dto: ServerBansDto,
    @CurrentUser('id') actor: string,
  ) {
    return this.service.saveBans(actor, node, dto);
  }
}
