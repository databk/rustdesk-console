import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
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

  @Get(':node/peers')
  @RequirePermission('servers.view')
  peers(@Param('node') node: string) {
    return this.service.request(node, '/v1/peers');
  }

  @Get(':node/sessions')
  @RequirePermission('servers.view')
  sessions(@Param('node') node: string) {
    return this.service.request(node, '/v1/sessions');
  }

  @Delete(':node/sessions/:uuid')
  @RequirePermission('servers.disconnect')
  disconnect(
    @Param('node') node: string,
    @Param('uuid') uuid: string,
    @CurrentUser('id') actor: string,
  ) {
    return this.service.mutate(
      actor,
      node,
      `/v1/sessions/${encodeURIComponent(uuid)}`,
      'DELETE',
    );
  }

  @Get(':node/services/:service/logs')
  @RequirePermission('servers.view')
  logs(
    @Param('node') node: string,
    @Param('service', new ParseEnumPipe(RustdeskService))
    service: RustdeskService,
    @Query('tail', new DefaultValuePipe(200), ParseIntPipe) tail: number,
  ) {
    return this.service.request(
      node,
      `/v1/services/${service}/logs?tail=${tail}`,
    );
  }

  @Get(':node/services/:service/config')
  @RequirePermission('servers.config')
  config(
    @Param('node') node: string,
    @Param('service', new ParseEnumPipe(RustdeskService))
    service: RustdeskService,
  ) {
    return this.service.request(node, `/v1/services/${service}/config`);
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
    return this.service.mutate(
      actor,
      node,
      `/v1/services/${service}/config`,
      'PUT',
      dto,
      { settings: Object.keys(dto.values) },
    );
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
    return this.service.mutate(
      actor,
      node,
      `/v1/services/${service}/${action}`,
      'POST',
    );
  }

  @Get(':node/bans')
  @RequirePermission('servers.ban')
  bans(@Param('node') node: string) {
    return this.service.request(node, '/v1/bans');
  }

  @Put(':node/bans')
  @RequirePermission('servers.ban')
  saveBans(
    @Param('node') node: string,
    @Body() dto: ServerBansDto,
    @CurrentUser('id') actor: string,
  ) {
    return this.service.mutate(actor, node, '/v1/bans', 'PUT', dto, {
      device_ids: dto.device_ids,
      ips: dto.ips,
    });
  }
}
