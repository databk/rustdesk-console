import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';
import { ServerBanPolicy } from './entities/server-ban-policy.entity';
import { ServerNode, ServerRole } from './entities/server-node.entity';
import { ServerBansDto, ServerConfigDto } from './server-management.dto';

const BAN_POLICY_ID = 1;
const MAX_NODES = 100;

@Injectable()
export class ServerManagementService {
  private readonly logger = new Logger(ServerManagementService.name);

  constructor(
    @InjectRepository(ServerNode)
    private readonly nodeRepository: Repository<ServerNode>,
    @InjectRepository(ServerBanPolicy)
    private readonly banPolicyRepository: Repository<ServerBanPolicy>,
    private readonly audit: RbacAuditService,
  ) {}

  async list() {
    const nodes = await this.nodeRepository.find();
    return { data: nodes };
  }

  async create(
    role: ServerRole,
    name: string,
    url: string,
    managementToken: string,
  ) {
    const count = await this.nodeRepository.count();
    if (count >= MAX_NODES) {
      throw new ConflictException('Server node limit reached');
    }
    if (role === 'hbbs') {
      const existing = await this.nodeRepository.findOne({
        where: { role: 'hbbs' },
      });
      if (existing) {
        throw new ConflictException('Only one hbbs node is supported');
      }
    }
    const normalizedUrl = this.validateUrl(url);
    const node = this.nodeRepository.create({
      guid: uuidv4(),
      role,
      name: name.trim(),
      url: normalizedUrl,
      managementToken,
      status: 'offline',
      lastCheckedAt: null,
    });
    return this.nodeRepository.save(node);
  }

  async update(
    guid: string,
    patch: { name?: string; url?: string; managementToken?: string },
  ) {
    const node = await this.nodeRepository.findOne({ where: { guid } });
    if (!node) throw new NotFoundException('Server node not found');
    if (patch.name !== undefined) node.name = patch.name.trim();
    if (patch.url !== undefined) node.url = this.validateUrl(patch.url);
    if (patch.managementToken !== undefined)
      node.managementToken = patch.managementToken;
    return this.nodeRepository.save(node);
  }

  async remove(guid: string) {
    const node = await this.nodeRepository.findOne({ where: { guid } });
    if (!node) throw new NotFoundException('Server node not found');
    await this.nodeRepository.remove(node);
  }

  async getNode(guid: string): Promise<ServerNode> {
    const node = await this.nodeRepository.findOne({ where: { guid } });
    if (!node) throw new NotFoundException('Server node not found');
    return node;
  }

  async request(
    node: ServerNode,
    path: string,
    method = 'GET',
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(`${node.url}${path}`, {
        method,
        redirect: 'error',
        headers: {
          authorization: `Bearer ${node.managementToken}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(method === 'GET' ? 10000 : 240000),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ServiceUnavailableException('Server management API unavailable');
    }
    if (!response.ok) {
      if (response.status === 400) {
        throw new BadRequestException('Invalid server management request');
      }
      if (response.status === 403) {
        throw new ForbiddenException('Server management credentials rejected');
      }
      if (response.status === 404) {
        throw new NotFoundException('Server resource not found');
      }
      if (response.status === 409) {
        throw new ConflictException('Server configuration conflicts');
      }
      if (response.status === 504) {
        throw new GatewayTimeoutException(
          'Server management operation timed out',
        );
      }
      throw new BadGatewayException('Server management operation failed');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new BadGatewayException('Empty server response');
    let size = 0;
    const chunks: Buffer[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new Error('Response too large');
        }
        chunks.push(Buffer.from(value));
      }
      const result: unknown = JSON.parse(Buffer.concat(chunks).toString());
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error('Invalid response');
      }
      return result as Record<string, unknown>;
    } catch {
      throw new BadGatewayException('Invalid server management response');
    } finally {
      reader.releaseLock();
    }
  }

  async mutate(
    actor: string,
    node: ServerNode,
    path: string,
    method: string,
    body?: unknown,
    details?: Record<string, unknown>,
  ) {
    let result: Record<string, unknown>;
    try {
      result = await this.request(node, path, method, body);
    } catch (error) {
      await this.audit.recordDenied({
        actorUserGuid: actor,
        targetType: 'server',
        targetGuid: node.guid,
        action: `${method} ${path}`,
        reason: 'Server management operation failed',
      });
      throw error;
    }
    try {
      await this.audit.record({
        actorUserGuid: actor,
        targetType: 'server',
        targetGuid: node.guid,
        action: `${method} ${path}`,
        result: 'allowed',
        afterState: details,
      });
    } catch {
      this.logger.warn('Unable to persist server management audit');
    }
    return result;
  }

  async getPeers(guid: string) {
    const node = await this.getNode(guid);
    if (node.role !== 'hbbs') {
      throw new BadRequestException('Peers are only available on hbbs nodes');
    }
    return this.request(node, '/v1/peers');
  }

  async getSessions(guid: string) {
    const node = await this.getNode(guid);
    if (node.role !== 'hbbr') {
      throw new BadRequestException(
        'Sessions are only available on hbbr nodes',
      );
    }
    return this.request(node, '/v1/sessions');
  }

  async disconnectSession(actor: string, guid: string, uuid: string) {
    const node = await this.getNode(guid);
    if (node.role !== 'hbbr') {
      throw new BadRequestException(
        'Session disconnect is only available on hbbr nodes',
      );
    }
    return this.mutate(
      actor,
      node,
      `/v1/sessions/${encodeURIComponent(uuid)}`,
      'DELETE',
    );
  }

  async getConfig(guid: string) {
    const node = await this.getNode(guid);
    return this.request(node, '/v1/config');
  }

  async saveConfig(actor: string, guid: string, dto: ServerConfigDto) {
    const node = await this.getNode(guid);
    return this.mutate(actor, node, '/v1/config', 'PUT', dto, {
      settings: Object.keys(dto.values),
    });
  }

  async getBans() {
    const policy = await this.banPolicyRepository.findOne({
      where: { id: BAN_POLICY_ID },
    });
    if (!policy) {
      return { device_ids: [], ips: [] };
    }
    return {
      device_ids: JSON.parse(policy.deviceIds) as string[],
      ips: JSON.parse(policy.ips) as string[],
    };
  }

  async applyBans(actor: string, dto: ServerBansDto) {
    const normalized = {
      device_ids: [...new Set(dto.device_ids)].sort(),
      ips: [
        ...new Set(
          dto.ips.map((ip) =>
            ip.toLowerCase().startsWith('::ffff:') ? ip.slice(7) : ip,
          ),
        ),
      ].sort(),
    };

    let policy = await this.banPolicyRepository.findOne({
      where: { id: BAN_POLICY_ID },
    });
    if (!policy) {
      policy = this.banPolicyRepository.create({
        id: BAN_POLICY_ID,
        deviceIds: JSON.stringify(normalized.device_ids),
        ips: JSON.stringify(normalized.ips),
      });
    } else {
      policy.deviceIds = JSON.stringify(normalized.device_ids);
      policy.ips = JSON.stringify(normalized.ips);
    }
    await this.banPolicyRepository.save(policy);

    const nodes = await this.nodeRepository.find();
    const results = await Promise.allSettled(
      nodes.map(async (node) => {
        await this.request(node, '/v1/bans', 'PUT', normalized);
        return { guid: node.guid, role: node.role, state: 'applied' };
      }),
    );
    const synchronization = results.map((result, index) => {
      const node = nodes[index];
      if (result.status === 'fulfilled') return result.value;
      this.logger.warn(
        `Ban synchronization failed for node ${node.guid}: ${result.reason}`,
      );
      return { guid: node.guid, role: node.role, state: 'pending' };
    });

    try {
      await this.audit.record({
        actorUserGuid: actor,
        targetType: 'server',
        targetGuid: null,
        action: 'PUT /v1/bans',
        result: 'allowed',
        afterState: {
          device_ids: normalized.device_ids.length,
          ips: normalized.ips.length,
        },
      });
    } catch {
      this.logger.warn('Unable to persist server ban audit');
    }

    return { ...normalized, synchronization };
  }

  async syncBansToNode(node: ServerNode): Promise<boolean> {
    const policy = await this.banPolicyRepository.findOne({
      where: { id: BAN_POLICY_ID },
    });
    if (!policy) return true;
    const bans = {
      device_ids: JSON.parse(policy.deviceIds) as string[],
      ips: JSON.parse(policy.ips) as string[],
    };
    try {
      await this.request(node, '/v1/bans', 'PUT', bans);
      return true;
    } catch {
      return false;
    }
  }

  private validateUrl(url: string): string {
    const parsed = new URL(url);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== '/'
    ) {
      throw new BadRequestException('Server URL must be an HTTP(S) origin');
    }
    return parsed.origin;
  }
}
