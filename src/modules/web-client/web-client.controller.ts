import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PeerService } from '../device-group/peer.service';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { SkipConsoleAudit } from '../rbac/decorators/skip-console-audit.decorator';
import { WebClientGateway } from './web-client.gateway';
import { WebClientAuthorizationService } from './web-client-authorization.service';
import type { WebClientActor } from './web-client-authorization.service';
import {
  WebClientDevicesDto,
  WebClientEmptyBodyPipe,
  WebClientEventDto,
  WebClientSessionDto,
} from './dto/web-client.dto';
import { WebClientService } from './web-client.service';
import { WebClientSessionService } from './web-client-session.service';

@Controller('web-client')
@SkipConsoleAudit()
export class WebClientController {
  constructor(
    private readonly service: WebClientService,
    private readonly authorization: WebClientAuthorizationService,
    private readonly peers: PeerService,
    private readonly sessions: WebClientSessionService,
    private readonly gateway: WebClientGateway,
  ) {}

  @Get('config')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('web_client.connect')
  getConfiguration() {
    return this.service.getConfiguration();
  }

  @Get('sessions/:guid/network')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('web_client.connect')
  async getSessionNetwork(
    @CurrentUser() actor: WebClientActor,
    @Param('guid', new ParseUUIDPipe()) guid: string,
  ) {
    await this.sessions.requireOwnedActive(actor, guid);
    const observation = await this.gateway.observeNetwork(guid);
    // A delayed collector result cannot outlive a grant, ownership or authorization.
    await this.sessions.requireOwnedActive(actor, guid);
    return observation;
  }

  @Get('devices')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('web_client.connect')
  async getDevices(
    @CurrentUser('id') actorGuid: string,
    @Query() query: WebClientDevicesDto,
  ) {
    this.service.requireConfiguration();
    const scope = await this.authorization.requireScope(actorGuid);
    return this.peers.getAccessiblePeers(actorGuid, query, false, scope);
  }

  // 申请由服务内做对象级授权并记录拒绝，避免通用拦截器保存票据。
  @Post('sessions')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  create(
    @CurrentUser() actor: WebClientActor,
    @Body() dto: WebClientSessionDto,
  ) {
    return this.sessions.create(actor, dto.targetId);
  }

  @Post('sessions/:guid/files')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  createFile(
    @CurrentUser() actor: WebClientActor,
    @Param('guid', new ParseUUIDPipe()) guid: string,
    @Body(new WebClientEmptyBodyPipe()) _body: unknown,
  ) {
    return this.sessions.createFile(actor, guid);
  }

  @Post('sessions/:guid/events')
  @Throttle({ default: { ttl: 60_000, limit: 600 } })
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  report(
    @CurrentUser() actor: WebClientActor,
    @Param('guid', new ParseUUIDPipe()) guid: string,
    @Body() dto: WebClientEventDto,
  ) {
    return this.sessions.report(actor, guid, dto);
  }

  @Delete('sessions/:guid')
  @Header('Cache-Control', 'no-store')
  end(
    @CurrentUser() actor: WebClientActor,
    @Param('guid', new ParseUUIDPipe()) guid: string,
  ) {
    return this.sessions.end(actor, guid);
  }
}
