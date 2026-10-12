import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Peer } from '../../common/entities/peer.entity';
import { DeviceGroupModule } from '../device-group/device-group.module';
import { RbacModule } from '../rbac/rbac.module';
import { ServerManagementModule } from '../server-management/server-management.module';
import { UserToken } from '../user/entities/user-token.entity';
import { WebClientAuthorizationService } from './web-client-authorization.service';
import { WebClientController } from './web-client.controller';
import { WebClientGateway } from './web-client.gateway';
import { WebClientService } from './web-client.service';
import { WebClientSessionService } from './web-client-session.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Peer, UserToken]),
    RbacModule,
    DeviceGroupModule,
    ServerManagementModule,
  ],
  controllers: [WebClientController],
  providers: [
    WebClientService,
    WebClientAuthorizationService,
    WebClientSessionService,
    WebClientGateway,
  ],
})
export class WebClientModule {}
