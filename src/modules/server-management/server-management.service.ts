import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';

interface NodeConfig {
  id: string;
  name: string;
  url: string;
  token: string;
}

@Injectable()
export class ServerManagementService {
  private readonly nodes: NodeConfig[];
  private readonly logger = new Logger(ServerManagementService.name);

  constructor(
    config: ConfigService,
    private readonly audit: RbacAuditService,
  ) {
    const raw = config.get<string>('RUSTDESK_NODES');
    let nodes: unknown;
    try {
      nodes = raw ? (JSON.parse(raw) as unknown) : [];
    } catch {
      throw new Error('RUSTDESK_NODES must be a JSON array');
    }
    if (!Array.isArray(nodes) || nodes.length > 100) {
      throw new Error('RUSTDESK_NODES must contain at most 100 nodes');
    }
    const identifiers = new Set<string>();
    this.nodes = nodes.map((value: unknown) => {
      const node = value as NodeConfig;
      if (
        !node ||
        typeof node.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(node.id) ||
        identifiers.has(node.id) ||
        typeof node.name !== 'string' ||
        !node.name.trim() ||
        node.name.length > 100 ||
        typeof node.token !== 'string' ||
        node.token.length < 32 ||
        typeof node.url !== 'string'
      ) {
        throw new Error('Invalid or duplicate RUSTDESK_NODES entry');
      }
      const url = new URL(node.url);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
      ) {
        throw new Error('Node URL must be an HTTP(S) origin');
      }
      identifiers.add(node.id);
      return { ...node, url: url.origin };
    });
  }

  async list() {
    return {
      data: await Promise.all(
        this.nodes.map(async (node) => {
          try {
            const status = await this.request(node.id, '/v1/status');
            if (status.api_version !== 1 || status.node_id !== node.id) {
              throw new BadGatewayException('Incompatible node management API');
            }
            return { ...status, id: node.id, name: node.name, reachable: true };
          } catch {
            return {
              id: node.id,
              name: node.name,
              reachable: false,
              services: [],
            };
          }
        }),
      ),
    };
  }

  async request(
    nodeId: string,
    path: string,
    method = 'GET',
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const node = this.nodes.find((item) => item.id === nodeId);
    if (!node) throw new NotFoundException('Server node not found');
    let response: Response;
    try {
      response = await fetch(`${node.url}${path}`, {
        method,
        redirect: 'error',
        headers: {
          authorization: `Bearer ${node.token}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(method === 'GET' ? 10000 : 240000),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ServiceUnavailableException('Server node unavailable');
    }
    if (!response.ok) {
      if (response.status === 400) {
        throw new BadRequestException('Invalid server management request');
      }
      if (response.status === 404) {
        throw new NotFoundException('Server resource not found');
      }
      if (response.status === 409) {
        throw new BadRequestException('Server configuration conflicts');
      }
      if (response.status === 504) {
        throw new GatewayTimeoutException(
          'Server management operation timed out',
        );
      }
      throw new BadGatewayException('Server management operation failed');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new BadGatewayException('Empty node response');
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
      throw new BadGatewayException('Invalid node management response');
    } finally {
      reader.releaseLock();
    }
  }

  async mutate(
    actor: string,
    nodeId: string,
    path: string,
    method: string,
    body?: unknown,
    details?: Record<string, unknown>,
  ) {
    let result: Record<string, unknown>;
    try {
      result = await this.request(nodeId, path, method, body);
    } catch (error) {
      await this.audit.recordDenied({
        actorUserGuid: actor,
        targetType: 'server',
        targetGuid: nodeId,
        action: `${method} ${path}`,
        reason: 'Server management operation failed',
      });
      throw error;
    }
    try {
      await this.audit.record({
        actorUserGuid: actor,
        targetType: 'server',
        targetGuid: nodeId,
        action: `${method} ${path}`,
        result: 'allowed',
        afterState: details,
      });
    } catch {
      this.logger.warn('Unable to persist server management audit');
    }
    return result;
  }
}
