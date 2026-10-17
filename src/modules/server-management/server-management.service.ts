import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  NotImplementedException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';
import {
  createObserver,
  unavailable,
} from '../../../network/tcp-observation.js';
import type {
  TcpObservation,
  TcpTuple,
} from '../../../network/tcp-observation.js';
import { ServerEventsService } from './server-events.service';
import type { ServerManagementRuntimeConfig } from './server-management-settings.service';
import { ServerManagementSettingsService } from './server-management-settings.service';
import {
  RustdeskService,
  ServiceAction,
  type ServerBansDto,
  type ServerConfigDto,
} from './server-management.dto';

interface RelaySummary {
  id: string;
  address?: string | null;
  version?: string;
  uptime_seconds?: number;
  sessions_count?: number;
  last_heartbeat_age_seconds?: number;
}

type ResolvedNode = { kind: 'primary' } | { kind: 'relay'; relayId: string };
type ServiceTarget = { kind: 'direct' } | { kind: 'relay'; relayId: string };

const REQUEST_TIMEOUT_GET_MS = 15_000;
const REQUEST_TIMEOUT_MUTATION_MS = 30_000;
const RESPONSE_LIMIT = 8 * 1024 * 1024;
const LOG_LIMIT_MAX = 2000;

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectField(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Management API v2 client. Console talks to a single hbbs upstream: local
// services are addressed directly and relay services through the hbbs relay
// proxy endpoints, so one credential controls the whole deployment while the
// existing frontend REST contract stays intact.
@Injectable()
export class ServerManagementService {
  private readonly logger = new Logger(ServerManagementService.name);
  private readonly observer = createObserver();

  constructor(
    private readonly settings: ServerManagementSettingsService,
    private readonly audit: RbacAuditService,
    private readonly events: ServerEventsService,
  ) {}

  // The runtime configuration lives in the database and can change at any
  // time; it is resolved per request so settings updates apply immediately.
  private async runtime(): Promise<ServerManagementRuntimeConfig> {
    return this.settings.getActiveConfig();
  }

  async list() {
    const config = await this.runtime();
    if (!config.url) return { data: [] };
    let status: Record<string, unknown> | null = null;
    try {
      status = await this.fetchJson(config, '/v1/status');
    } catch {
      status = null;
    }
    if (!status)
      return {
        data: [
          {
            id: config.nodeId,
            name: config.nodeName,
            reachable: false,
            services: [],
          },
        ],
      };
    const data: Array<Record<string, unknown>> = [
      {
        id: config.nodeId,
        name: config.nodeName,
        reachable: true,
        api_version: 1,
        node_id: config.nodeId,
        services: [this.serviceEntry('hbbs', status)],
      },
    ];
    let relays: RelaySummary[] = [];
    try {
      relays = await this.relaySummaries(config);
    } catch {
      relays = [];
    }
    for (const relay of relays) {
      // A relay that registered with the primary node id never shadows it.
      if (relay.id === config.nodeId) continue;
      data.push({
        id: relay.id,
        name: relay.id,
        relay: true,
        reachable: true,
        api_version: 1,
        node_id: relay.id,
        services: [
          this.serviceEntry('hbbr', {
            version: relay.version,
            uptime_seconds: relay.uptime_seconds,
            address: relay.address ?? null,
            sessions_count: relay.sessions_count,
            last_heartbeat_age_seconds: relay.last_heartbeat_age_seconds,
          }),
        ],
      });
    }
    return { data };
  }

  async networkSettings(nodeId?: string): Promise<TcpObservation> {
    const config = await this.runtime();
    if (!nodeId || nodeId === config.nodeId) return this.observer.system();
    const node = await this.requireNode(config, nodeId);
    // The integrated deployment shares one host network configuration; relay
    // namespaces are not observable through the v2 management API.
    return node.kind === 'relay'
      ? unavailable('system', 'namespace_unobservable')
      : this.observer.system();
  }

  async relayConnection(tuple: TcpTuple): Promise<TcpObservation> {
    // The local reverse socket must belong to hbbr, not a proxy or our sender.
    const local = await this.observer.connection(tuple, 'hbbr');
    if (local.status === 'identified') return local;
    // The v2 management API has no TCP observation endpoint, so only the
    // co-located case is observable.
    return unavailable('connection', local.reason ?? 'namespace_unobservable');
  }

  async peers(nodeId: string) {
    const config = await this.runtime();
    const node = await this.requireNode(config, nodeId);
    // hbbr has no peers endpoint; only hbbs registrations exist.
    if (node.kind === 'relay') return { data: [] };
    return this.fetchJson(config, '/v1/peers');
  }

  async sessions(nodeId: string) {
    const config = await this.runtime();
    const node = await this.requireNode(config, nodeId);
    if (node.kind === 'relay') {
      if (this.events.isFresh())
        return {
          data: this.events
            .getSessions()
            .filter((session) => session.relayId === node.relayId)
            .map((session) => session.info),
        };
      return this.fetchJson(
        config,
        `/v1/relays/${encodeURIComponent(node.relayId)}/sessions`,
      );
    }
    if (this.events.isFresh())
      return {
        data: this.events
          .getSessions()
          .map((session) => ({ ...session.info, relay_id: session.relayId })),
      };
    const relays = await this.relaySummaries(config);
    // Query every relay in parallel and tolerate individual failures so one
    // unresponsive relay cannot blank the whole session list.
    const batches = await Promise.all(
      relays.map(async (relay) => {
        try {
          const result = await this.fetchJson(
            config,
            `/v1/relays/${encodeURIComponent(relay.id)}/sessions`,
          );
          return asArray(result['data'])
            .filter(
              (info): info is Record<string, unknown> =>
                !!info && typeof info === 'object',
            )
            .map((info) => ({ ...info, relay_id: relay.id }));
        } catch (error) {
          this.logger.warn(
            `Unable to list sessions for relay ${relay.id}: ${String(error)}`,
          );
          return [];
        }
      }),
    );
    return { data: batches.flat() };
  }

  async disconnect(actor: string, nodeId: string, uuid: string) {
    const config = await this.runtime();
    const node = await this.requireNode(config, nodeId);
    return this.audited(
      actor,
      nodeId,
      `DELETE /v1/sessions/${uuid}`,
      undefined,
      async () => {
        const relayId =
          node.kind === 'relay'
            ? node.relayId
            : await this.locateSession(config, uuid);
        if (!relayId) throw new NotFoundException('Server session not found');
        return this.fetchJson(
          config,
          `/v1/relays/${encodeURIComponent(relayId)}/sessions/${encodeURIComponent(uuid)}`,
          'DELETE',
        );
      },
    );
  }

  async logs(nodeId: string, service: RustdeskService, tail: number) {
    if (!Number.isInteger(tail) || tail < 1 || tail > LOG_LIMIT_MAX)
      throw new BadRequestException('Invalid log limit');
    const config = await this.runtime();
    const target = await this.requireService(config, nodeId, service);
    const query = `?tail=${tail}`;
    const result =
      target.kind === 'direct'
        ? await this.fetchJson(config, `/v1/logs${query}`)
        : await this.fetchJson(
            config,
            `/v1/relays/${encodeURIComponent(target.relayId)}/logs${query}`,
          );
    const lines = asArray(result['data']).filter(
      (line): line is string => typeof line === 'string',
    );
    return { text: lines.join('\n') };
  }

  async config(nodeId: string, service: RustdeskService) {
    const config = await this.runtime();
    const target = await this.requireService(config, nodeId, service);
    const result =
      target.kind === 'direct'
        ? await this.fetchJson(config, '/v1/config')
        : await this.fetchJson(
            config,
            `/v1/relays/${encodeURIComponent(target.relayId)}/config`,
          );
    return this.configView(result);
  }

  async saveConfig(
    actor: string,
    nodeId: string,
    service: RustdeskService,
    dto: ServerConfigDto,
  ) {
    const config = await this.runtime();
    const target = await this.requireService(config, nodeId, service);
    const path =
      target.kind === 'direct'
        ? '/v1/config'
        : `/v1/relays/${encodeURIComponent(target.relayId)}/config`;
    return this.audited(
      actor,
      nodeId,
      `PUT /v1/services/${service}/config`,
      { settings: Object.keys(dto.values) },
      async () => {
        await this.fetchJson(config, path, 'PUT', { values: dto.values });
        return this.configView(await this.fetchJson(config, path));
      },
    );
  }

  async serviceAction(
    actor: string,
    nodeId: string,
    service: RustdeskService,
    action: ServiceAction,
  ) {
    const config = await this.runtime();
    const target = await this.requireService(config, nodeId, service);
    if (action === ServiceAction.START || action === ServiceAction.STOP)
      throw new NotImplementedException(
        'Container lifecycle actions are not supported by this deployment',
      );
    if (action === ServiceAction.RESTART) {
      const path =
        target.kind === 'direct'
          ? '/v1/restart'
          : `/v1/relays/${encodeURIComponent(target.relayId)}/restart`;
      return this.audited(
        actor,
        nodeId,
        `POST /v1/services/${service}/${action}`,
        undefined,
        () => this.fetchJson(config, path, 'POST'),
      );
    }
    // Apply: dynamic entries are already live; a restart is only required
    // when restart-required entries remain, mirroring the old lifecycle.
    const configPath =
      target.kind === 'direct'
        ? '/v1/config'
        : `/v1/relays/${encodeURIComponent(target.relayId)}/config`;
    return this.audited(
      actor,
      nodeId,
      `POST /v1/services/${service}/${action}`,
      undefined,
      async () => {
        const current = await this.fetchJson(config, configPath);
        if (!Object.keys(objectField(current['pending_restart'])).length)
          return { state: 'applied' };
        const path =
          target.kind === 'direct'
            ? '/v1/restart'
            : `/v1/relays/${encodeURIComponent(target.relayId)}/restart`;
        return this.fetchJson(config, path, 'POST');
      },
    );
  }

  async bans(nodeId: string) {
    const config = await this.runtime();
    await this.requireNode(config, nodeId);
    return this.bansView(await this.fetchJson(config, '/v1/bans'));
  }

  async saveBans(actor: string, nodeId: string, dto: ServerBansDto) {
    const config = await this.runtime();
    await this.requireNode(config, nodeId);
    return this.audited(
      actor,
      nodeId,
      'PUT /v1/bans',
      { device_ids: dto.device_ids, ips: dto.ips },
      async () => {
        await this.fetchJson(config, '/v1/bans', 'PUT', {
          device_ids: dto.device_ids,
          ips: dto.ips,
        });
        return this.bansView(dto);
      },
    );
  }

  private bansView(bans: {
    device_ids?: unknown;
    ips?: unknown;
  }): Record<string, unknown> {
    return {
      device_ids: asArray(bans.device_ids).filter(
        (id): id is string => typeof id === 'string',
      ),
      ips: asArray(bans.ips).filter(
        (ip): ip is string => typeof ip === 'string',
      ),
      // hbbs owns the policy and pushes it to every registered relay on
      // update and registration, so both services report it active.
      synchronization: {
        hbbs: { state: 'applied' },
        hbbr: { state: 'applied' },
      },
    };
  }

  private configView(result: Record<string, unknown>) {
    const values = objectField(result['values']);
    const pending = objectField(result['pending_restart']);
    return {
      schema: asArray(result['schema']),
      values,
      effective_values: values,
      pending_restart: Object.keys(pending).length > 0,
      pending_restart_detail: pending,
      available: true,
    };
  }

  private serviceEntry(
    service: 'hbbs' | 'hbbr',
    runtime: Record<string, unknown>,
  ) {
    const uptime = Number(runtime['uptime_seconds']);
    return {
      service,
      state: 'running',
      running: true,
      ...(Number.isFinite(uptime) && uptime >= 0
        ? {
            started_at: new Date(Date.now() - uptime * 1000).toISOString(),
          }
        : {}),
      runtime,
      available: true,
    };
  }

  private async requireNode(
    config: ServerManagementRuntimeConfig,
    nodeId: string,
  ): Promise<ResolvedNode> {
    const node = await this.resolveNode(config, nodeId);
    if (!node) throw new NotFoundException('Server node not found');
    return node;
  }

  private async resolveNode(
    config: ServerManagementRuntimeConfig,
    nodeId: string,
  ): Promise<ResolvedNode | null> {
    if (!config.url) return null;
    if (nodeId === config.nodeId) return { kind: 'primary' };
    if (this.events.isFresh() && this.events.hasRelay(nodeId))
      return { kind: 'relay', relayId: nodeId };
    const relays = await this.relaySummaries(config).catch(
      () => [] as RelaySummary[],
    );
    return relays.some((relay) => relay.id === nodeId)
      ? { kind: 'relay', relayId: nodeId }
      : null;
  }

  private async requireService(
    config: ServerManagementRuntimeConfig,
    nodeId: string,
    service: RustdeskService,
  ): Promise<ServiceTarget> {
    const node = await this.requireNode(config, nodeId);
    if (node.kind === 'primary') {
      if (service !== RustdeskService.HBBS)
        throw new NotFoundException('Service not available on this node');
      return { kind: 'direct' };
    }
    if (service !== RustdeskService.HBBR)
      throw new NotFoundException('Service not available on this node');
    return { kind: 'relay', relayId: node.relayId };
  }

  private async relaySummaries(
    config: ServerManagementRuntimeConfig,
  ): Promise<RelaySummary[]> {
    const result = await this.fetchJson(config, '/v1/relays');
    return asArray(result['data']).filter(
      (relay): relay is RelaySummary =>
        !!relay &&
        typeof relay === 'object' &&
        typeof (relay as RelaySummary).id === 'string' &&
        !!(relay as RelaySummary).id,
    );
  }

  private async locateSession(
    config: ServerManagementRuntimeConfig,
    uuid: string,
  ): Promise<string | undefined> {
    if (this.events.isFresh()) return this.events.getSessionRelay(uuid);
    const relays = await this.relaySummaries(config).catch(
      () => [] as RelaySummary[],
    );
    for (const relay of relays) {
      const result = await this.fetchJson(
        config,
        `/v1/relays/${encodeURIComponent(relay.id)}/sessions`,
      ).catch(() => null);
      const found = asArray(result?.['data']).some(
        (info) =>
          !!info &&
          typeof info === 'object' &&
          (info as { uuid?: unknown }).uuid === uuid,
      );
      if (found) return relay.id;
    }
    return undefined;
  }

  private async audited<T>(
    actor: string,
    nodeId: string,
    action: string,
    details: Record<string, unknown> | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    let result: T;
    try {
      result = await work();
    } catch (error) {
      await this.audit.recordDenied({
        actorUserGuid: actor,
        targetType: 'server',
        targetGuid: nodeId,
        action,
        reason: 'Server management operation failed',
      });
      throw error;
    }
    try {
      await this.audit.record({
        actorUserGuid: actor,
        targetType: 'server',
        targetGuid: nodeId,
        action,
        result: 'allowed',
        afterState: details,
      });
    } catch {
      this.logger.warn('Unable to persist server management audit');
    }
    return result;
  }

  private async fetchJson(
    config: ServerManagementRuntimeConfig,
    path: string,
    method: 'GET' | 'PUT' | 'POST' | 'DELETE' = 'GET',
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    if (!config.url)
      throw new ServiceUnavailableException(
        'Server management is not configured',
      );
    let response: Response;
    try {
      response = await fetch(`${config.url}${path}`, {
        method,
        redirect: 'error',
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(
          method === 'GET'
            ? REQUEST_TIMEOUT_GET_MS
            : REQUEST_TIMEOUT_MUTATION_MS,
        ),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ServiceUnavailableException('Server management unavailable');
    }
    if (!response.ok) {
      if (response.status === 400)
        throw new BadRequestException('Invalid server management request');
      if (response.status === 404)
        throw new NotFoundException('Server resource not found');
      if (response.status === 409)
        throw new BadRequestException('Server configuration conflicts');
      if (response.status === 504)
        throw new GatewayTimeoutException(
          'Server management operation timed out',
        );
      throw new BadGatewayException('Server management operation failed');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new BadGatewayException('Empty management response');
    let size = 0;
    const chunks: Buffer[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > RESPONSE_LIMIT) {
          await reader.cancel();
          throw new Error('Response too large');
        }
        chunks.push(Buffer.from(value));
      }
      const result: unknown = JSON.parse(Buffer.concat(chunks).toString());
      if (!result || typeof result !== 'object' || Array.isArray(result))
        throw new Error('Invalid response');
      return result as Record<string, unknown>;
    } catch {
      throw new BadGatewayException('Invalid management response');
    } finally {
      reader.releaseLock();
    }
  }
}
