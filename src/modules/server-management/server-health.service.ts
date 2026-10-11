import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { businessWritesAllowed } from '../../updater/maintenance';
import { ServerNode } from './entities/server-node.entity';
import { ServerManagementService } from './server-management.service';

const HEALTH_CHECK_INTERVAL_MS = 30000;

@Injectable()
export class ServerHealthService {
  private readonly logger = new Logger(ServerHealthService.name);

  constructor(
    @InjectRepository(ServerNode)
    private readonly nodeRepository: Repository<ServerNode>,
    private readonly serverManagementService: ServerManagementService,
  ) {}

  @Interval(HEALTH_CHECK_INTERVAL_MS)
  async handleHealthCheck(): Promise<void> {
    if (!businessWritesAllowed()) return;
    try {
      const nodes = await this.nodeRepository.find();
      await Promise.allSettled(nodes.map((node) => this.checkNode(node)));
    } catch (error: unknown) {
      const stack = error instanceof Error ? error.stack : String(error);
      this.logger.error('Server health check failed', stack);
    }
  }

  private async checkNode(node: ServerNode): Promise<void> {
    try {
      const status = await this.serverManagementService.request(
        node,
        '/v1/status',
      );
      if (status.api_version !== 1 || status.service !== node.role) {
        await this.updateStatus(node.guid, 'degraded');
        return;
      }
      await this.updateStatus(node.guid, 'online');
    } catch {
      await this.updateStatus(node.guid, 'offline');
    }
  }

  private async updateStatus(
    guid: string,
    status: 'online' | 'offline' | 'degraded',
  ): Promise<void> {
    await this.nodeRepository.update(guid, {
      status,
      lastCheckedAt: new Date(),
    });
  }
}