import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacModule } from '../rbac/rbac.module';
import { ServerBanPolicy } from './entities/server-ban-policy.entity';
import { ServerNode } from './entities/server-node.entity';
import { ServerHealthService } from './server-health.service';
import { ServerManagementController } from './server-management.controller';
import { ServerManagementService } from './server-management.service';

@Module({
  imports: [
    RbacModule,
    TypeOrmModule.forFeature([ServerNode, ServerBanPolicy]),
  ],
  controllers: [ServerManagementController],
  providers: [ServerManagementService, ServerHealthService],
})
export class ServerManagementModule {}
