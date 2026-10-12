import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import type { LocalManagement } from '../../../agent/local.mjs';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';
import {
  createObserver,
  parseObservation,
  unavailable,
} from '../../../network/tcp-observation.js';
import type {
  TcpObservation,
  TcpTuple,
} from '../../../network/tcp-observation.js';

interface NodeConfig {
  id: string;
  name: string;
  url: string;
  token: string;
}

@Injectable()
export class ServerManagementService implements OnModuleInit, OnModuleDestroy {
  private readonly nodes: NodeConfig[];
  private readonly webClientTcpRelayNodeId: string | undefined;
  private readonly observer = createObserver();
  private readonly logger = new Logger(ServerManagementService.name);
  private localNode?: { id: string; name: string };
  private localManagement?: LocalManagement;
  private policyTimer?: ReturnType<typeof setTimeout>;
  private stopping = false;

  constructor(
    private readonly config: ConfigService,
    private readonly audit: RbacAuditService,
  ) {
    this.webClientTcpRelayNodeId = config.get<string>(
      'WEB_CLIENT_TCP_RELAY_NODE_ID',
    );
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
    if (config.get<string>('SERVER_MANAGEMENT_LOCAL') === '1') {
      const id = config.get<string>('NODE_ID') || 'local';
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || identifiers.has(id)) {
        throw new Error('Invalid or duplicate local management node');
      }
      this.localNode = { id, name: 'RustDesk' };
    }
  }

  async onModuleInit() {
    if (!this.localNode) return;
    const { createLocalManagement } = await import('../../../agent/local.mjs');
    this.localManagement = createLocalManagement({
      nodeId: this.localNode.id,
      serverToken: this.config.get<string>('SERVER_MANAGEMENT_TOKEN') || '',
      directory:
        this.config.get<string>('MANAGEMENT_DIR') ||
        join(this.config.get<string>('DATA_DIR') || '/data', 'management'),
      socket:
        this.config.get<string>('DOCKER_SOCKET') || '/var/run/docker.sock',
      containers: {
        hbbs: this.config.get<string>('HBBS_CONTAINER') || 'hbbs',
        hbbr: this.config.get<string>('HBBR_CONTAINER') || 'hbbr',
      },
      urls: {
        hbbs:
          this.config.get<string>('HBBS_MANAGEMENT_URL') || 'http://hbbs:21120',
        hbbr:
          this.config.get<string>('HBBR_MANAGEMENT_URL') || 'http://hbbr:21121',
      },
    });
    this.schedulePolicySync();
  }

  onModuleDestroy() {
    this.stopping = true;
    clearTimeout(this.policyTimer);
  }

  private schedulePolicySync() {
    if (this.stopping) return;
    this.policyTimer = setTimeout(() => {
      void this.localManagement
        ?.syncPolicy()
        .catch(() =>
          this.logger.warn('Local server policy synchronization failed'),
        )
        .finally(() => this.schedulePolicySync());
    }, 10000);
    this.policyTimer.unref();
  }

  async list() {
    return {
      data: await Promise.all(
        [...(this.localNode ? [this.localNode] : []), ...this.nodes].map(
          async (node) => {
            try {
              const status = await this.request(node.id, '/v1/status');
              if (status.api_version !== 1 || status.node_id !== node.id) {
                throw new BadGatewayException(
                  'Incompatible node management API',
                );
              }
              return {
                ...status,
                id: node.id,
                name: node.name,
                reachable: true,
                ...(node.id === this.localNode?.id ? { local: true } : {}),
              };
            } catch {
              return {
                id: node.id,
                name: node.name,
                reachable: false,
                services: [],
                ...(node.id === this.localNode?.id ? { local: true } : {}),
              };
            }
          },
        ),
      ),
    };
  }

  async networkSettings(nodeId?: string): Promise<TcpObservation> {
    if (!nodeId) return this.observer.system();
    return this.readNetwork(nodeId, '/v1/network/tcp', 'system');
  }

  async relayConnection(tuple: TcpTuple): Promise<TcpObservation> {
    // The local reverse socket must belong to hbbr, not a proxy or our sender.
    const local = await this.observer.connection(tuple, 'hbbr');
    if (local.status === 'identified') return local;
    // No implicit association with the first/only management node.
    const nodeId = this.webClientTcpRelayNodeId;
    if (
      !nodeId ||
      !(
        nodeId === this.localNode?.id ||
        this.nodes.some((node) => node.id === nodeId)
      )
    )
      // An unsuccessful local lookup does not identify the remote hbbr environment.
      return unavailable(
        'connection',
        local.reason ?? 'namespace_unobservable',
      );
    const query = new URLSearchParams({
      local_address: tuple.local.address,
      local_port: String(tuple.local.port),
      remote_address: tuple.remote.address,
      remote_port: String(tuple.remote.port),
    });
    return this.readNetwork(
      nodeId,
      `/v1/network/tcp/relay?${query}`,
      'connection',
    );
  }

  private async readNetwork(
    nodeId: string,
    path: string,
    kind: TcpObservation['kind'],
  ): Promise<TcpObservation> {
    if (nodeId === this.localNode?.id) {
      try {
        const result = parseObservation(await this.request(nodeId, path));
        return result?.kind === kind
          ? result
          : unavailable(kind, 'invalid_response');
      } catch {
        return unavailable(kind, 'source_unavailable');
      }
    }
    const node = this.nodes.find((item) => item.id === nodeId);
    if (!node) throw new NotFoundException('Server node not found');
    let response: Response;
    try {
      response = await fetch(`${node.url}${path}`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(4000),
        headers: { authorization: `Bearer ${node.token}` },
      });
    } catch {
      return unavailable(kind, 'source_unavailable');
    }
    if (!response.ok) {
      await response.body?.cancel();
      return unavailable(
        kind,
        response.status === 403 ? 'permission_denied' : 'source_unavailable',
      );
    }
    const reader = response.body?.getReader();
    if (!reader) return unavailable(kind, 'invalid_response');
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 32768) {
          await reader.cancel();
          throw new Error('Response too large');
        }
        chunks.push(Buffer.from(value));
      }
      const observation = parseObservation(
        JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
      );
      return observation?.kind === kind
        ? observation
        : unavailable(kind, 'invalid_response');
    } catch {
      return unavailable(kind, 'invalid_response');
    } finally {
      reader.releaseLock();
    }
  }

  async request(
    nodeId: string,
    path: string,
    method = 'GET',
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    if (nodeId === this.localNode?.id) {
      if (!this.localManagement)
        throw new ServiceUnavailableException(
          'Local server management unavailable',
        );
      try {
        return await this.localManagement.request(method, path, body);
      } catch (error: unknown) {
        const status = (error as { status?: number })?.status;
        if (status === 400)
          throw new BadRequestException('Invalid server management request');
        if (status === 404)
          throw new NotFoundException('Server resource not found');
        if (status === 409)
          throw new BadRequestException('Server configuration conflicts');
        if (status === 504)
          throw new GatewayTimeoutException(
            'Server management operation timed out',
          );
        throw new BadGatewayException('Server management operation failed');
      }
    }
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
