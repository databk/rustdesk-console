import http from 'node:http';
import { randomUUID } from 'node:crypto';
import tcp from '../network/tcp-observation.js';

export class AgentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function decodeDockerOutput(buffer) {
  let offset = 0;
  const chunks = [];
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset + 4);
    if (offset + 8 + size > buffer.length)
      throw new AgentError(502, 'Invalid Docker output frame');
    chunks.push(buffer.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  if (offset !== buffer.length)
    throw new AgentError(502, 'Invalid Docker output frame');
  return Buffer.concat(chunks).toString();
}

// This driver accepts service names, never arbitrary container IDs or commands.
export class DockerDriver {
  constructor({
    socket = '/var/run/docker.sock',
    nodeId = 'local',
    containers = { hbbs: 'hbbs', hbbr: 'hbbr' },
    request,
  } = {}) {
    this.socket = socket;
    this.nodeId = nodeId;
    this.containers = containers;
    if (request) this.request = request;
  }

  request(method, path, data, binary = false) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          socketPath: this.socket,
          path: `/v1.45${path}`,
          method,
          headers:
            data === undefined ? {} : { 'content-type': 'application/json' },
        },
        (res) => {
          const chunks = [];
          let size = 0;
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > 8 * 1024 * 1024) {
              req.destroy(new AgentError(502, 'Docker response too large'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('error', reject);
          res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(
                new AgentError(
                  res.statusCode === 404 ? 404 : 502,
                  'Docker operation failed',
                ),
              );
              return;
            }
            try {
              resolve(
                binary
                  ? buffer
                  : buffer.length
                    ? JSON.parse(buffer.toString())
                    : undefined,
              );
            } catch {
              reject(new AgentError(502, 'Invalid Docker response'));
            }
          });
        },
      );
      req.setTimeout(30000, () =>
        req.destroy(new AgentError(504, 'Docker request timed out')),
      );
      req.on('error', reject);
      if (data !== undefined) req.write(JSON.stringify(data));
      req.end();
    });
  }

  async inspect(service) {
    if (!Object.hasOwn(this.containers, service))
      throw new AgentError(400, 'Unknown service');
    const info = await this.request(
      'GET',
      `/containers/${encodeURIComponent(this.containers[service])}/json`,
    );
    if (
      info.Config.Labels?.['io.rustdesk.console.service'] !== service ||
      info.Config.Labels?.['io.rustdesk.console.node'] !== this.nodeId
    ) {
      throw new AgentError(403, 'Container is not enrolled in this node');
    }
    return info;
  }

  async action(service, action) {
    if (!['start', 'stop', 'restart'].includes(action))
      throw new AgentError(400, 'Unknown action');
    const info = await this.inspect(service);
    if (
      (action === 'start' && info.State.Running) ||
      (action === 'stop' && !info.State.Running)
    )
      return;
    await this.request('POST', `/containers/${info.Id}/${action}?t=10`);
  }

  async observeTcpRelay(tuple) {
    if (!tcp.validTuple(tuple))
      throw new AgentError(400, 'Invalid TCP connection');
    const info = await this.inspect('hbbr');
    if (!info.State?.Running)
      return tcp.unavailable('connection', 'not_connected');
    const mode = info.HostConfig?.NetworkMode;
    let networkMode =
      mode === 'host'
        ? 'host'
        : mode === 'bridge' || mode === 'default'
          ? 'bridge'
          : mode === 'none' || mode?.startsWith('container:')
            ? 'isolated'
            : 'unknown';
    if (networkMode === 'unknown' && typeof mode === 'string' && mode) {
      // A named Compose network can still be a bridge. Inspect its driver,
      // rather than treating every custom network as an isolated mode.
      const endpoint = info.NetworkSettings?.Networks?.[mode];
      if (endpoint?.NetworkID) {
        try {
          const network = await this.request(
            'GET',
            `/networks/${encodeURIComponent(endpoint.NetworkID)}`,
          );
          if (network.Driver === 'bridge') networkMode = 'bridge';
          else if (['overlay', 'macvlan', 'ipvlan'].includes(network.Driver))
            networkMode = 'isolated';
        } catch {
          // A missing topology read must not erase an actual socket observation.
        }
      }
    }
    const environment = {
      system: 'linux',
      release: null,
      deployment: 'container',
      network_mode: networkMode,
      scope: mode === 'host' ? 'host' : 'container',
      source: 'ss',
    };
    const execution = await this.request(
      'POST',
      `/containers/${info.Id}/exec`,
      {
        AttachStdout: true,
        AttachStderr: true,
        Cmd: [
          'sh',
          '-c',
          'uname -s; uname -r; cat /proc/sys/net/ipv4/tcp_available_congestion_control 2>/dev/null || printf "\\n"; command -v ss >/dev/null || { printf "__NO_SS__\\n"; exit 0; }; ss "$@" 2>&1 || printf "__SS_ERROR__\\n"',
          'tcp-observation',
          ...tcp.connectionArgs(tuple),
        ],
      },
    );
    const buffer = await this.request(
      'POST',
      `/exec/${encodeURIComponent(execution.Id)}/start`,
      { Detach: false, Tty: false },
      true,
    );
    const output = decodeDockerOutput(buffer).split(/\r?\n/);
    if (output[0]?.trim() !== 'Linux')
      return tcp.unavailable('connection', 'platform_unobservable', {
        ...environment,
        system: 'unknown',
      });
    environment.release = output[1]?.trim() || null;
    if (output.includes('__NO_SS__'))
      return tcp.unavailable('connection', 'tool_unavailable', environment);
    if (output.includes('__SS_ERROR__'))
      return tcp.unavailable(
        'connection',
        /permission denied|operation not permitted/i.test(output.join('\n'))
          ? 'permission_denied'
          : 'source_unavailable',
        environment,
      );
    const result = tcp.parseSocket(output.slice(3).join('\n'), tuple, 'hbbr');
    const algorithms = output[2]?.trim().split(/\s+/) || [];
    const verified =
      algorithms.length > 0 &&
      algorithms.length <= 128 &&
      algorithms.every((name) =>
        /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(name),
      );
    return {
      ...tcp.unavailable('connection', result.reason, environment),
      status: result.algorithm ? 'identified' : 'unavailable',
      reason: result.reason,
      algorithm: result.algorithm,
      algorithms: verified ? [...new Set(algorithms)] : [],
      algorithms_verified: verified,
    };
  }

  async logs(service, tail = 200) {
    const info = await this.inspect(service);
    const buffer = await this.request(
      'GET',
      `/containers/${info.Id}/logs?stdout=1&stderr=1&tail=${tail}`,
      undefined,
      true,
    );
    if (info.Config.Tty) return buffer.toString();
    return decodeDockerOutput(buffer);
  }

  // Keep the old container until the replacement passes its authenticated API
  // health check. Preserve mounts, image, resources, network and host ports.
  async apply(service, port, ready, beforeRollback, commit = async () => {}) {
    const info = await this.inspect(service);
    const oldPort = Number(
      info.Config.Labels['io.rustdesk.console.port'] ||
        (service === 'hbbs' ? 21116 : 21117),
    );
    const rollbackFailures = [];
    const recover = async (step, operation) => {
      try {
        await operation();
      } catch {
        rollbackFailures.push(step);
        console.error(`Service rollback step failed: ${service}/${step}`);
      }
    };
    const reportRollback = (error) => {
      if (rollbackFailures.length && error instanceof Error)
        error.rollbackFailures = rollbackFailures;
    };
    if (port === oldPort) {
      try {
        await this.action(service, info.State.Running ? 'restart' : 'start');
        await ready(port);
        await commit();
      } catch (error) {
        await recover('configuration', beforeRollback);
        if (info.State.Running) {
          await recover('restart', () => this.action(service, 'restart'));
          await recover('readiness', () => ready(oldPort));
        } else {
          await recover('stop', () => this.action(service, 'stop'));
        }
        reportRollback(error);
        throw error;
      }
      return;
    }
    const name = this.containers[service];
    const backup = `${name}-rollback-${randomUUID()}`;
    const config = structuredClone(info.Config);
    const hostConfig = structuredClone(info.HostConfig);
    const protocols =
      service === 'hbbs'
        ? [
            [-1, 'tcp'],
            [0, 'tcp'],
            [0, 'udp'],
            [2, 'tcp'],
          ]
        : [
            [0, 'tcp'],
            [2, 'tcp'],
          ];
    const bindings = structuredClone(hostConfig.PortBindings || {});
    const exposed = structuredClone(config.ExposedPorts || {});
    for (const [offset, protocol] of protocols) {
      delete hostConfig.PortBindings?.[`${oldPort + offset}/${protocol}`];
      delete config.ExposedPorts?.[`${oldPort + offset}/${protocol}`];
    }
    for (const [offset, protocol] of protocols) {
      const oldKey = `${oldPort + offset}/${protocol}`;
      const newKey = `${port + offset}/${protocol}`;
      if (hostConfig.PortBindings?.[newKey] || config.ExposedPorts?.[newKey])
        throw new AgentError(409, 'Port conflicts with an existing binding');
      if (bindings[oldKey]) {
        hostConfig.PortBindings ||= {};
        hostConfig.PortBindings[newKey] = bindings[oldKey];
      }
      if (exposed[oldKey]) {
        config.ExposedPorts ||= {};
        config.ExposedPorts[newKey] = exposed[oldKey];
      }
    }
    config.Labels['io.rustdesk.console.deployment-port'] ||= String(oldPort);
    config.Labels['io.rustdesk.console.port'] = String(port);
    const endpoints = Object.fromEntries(
      Object.entries(info.NetworkSettings.Networks).map(
        ([network, endpoint]) => [
          network,
          {
            Aliases: (endpoint.Aliases || []).filter(
              (alias) => !/^[a-f0-9]{64}$/.test(alias),
            ),
            IPAMConfig: endpoint.IPAMConfig,
            DriverOpts: endpoint.DriverOpts,
          },
        ],
      ),
    );
    let renamed = false;
    let replacement;
    const disconnected = [];
    try {
      if (info.State.Running) await this.action(service, 'stop');
      await this.request(
        'POST',
        `/containers/${info.Id}/rename?name=${encodeURIComponent(backup)}`,
      );
      renamed = true;
      // Disconnect the backup from service aliases while it is retained.
      for (const network of Object.keys(endpoints)) {
        await this.request(
          'POST',
          `/networks/${encodeURIComponent(network)}/disconnect`,
          { Container: info.Id, Force: true },
        );
        disconnected.push(network);
      }
      replacement = await this.request(
        'POST',
        `/containers/create?name=${encodeURIComponent(name)}`,
        {
          ...config,
          HostConfig: hostConfig,
          NetworkingConfig: { EndpointsConfig: endpoints },
        },
      );
      await this.request('POST', `/containers/${replacement.Id}/start`);
      await ready(port);
      await commit();
    } catch (error) {
      // Recovery steps are independent: cleanup or rename failure must not
      // prevent reconnecting networks or attempting to start the old service.
      await recover('configuration', beforeRollback);
      if (replacement)
        await recover('remove-replacement', () =>
          this.request('DELETE', `/containers/${replacement.Id}?force=1&v=0`),
        );
      if (renamed) {
        await recover('restore-name', () =>
          this.request(
            'POST',
            `/containers/${info.Id}/rename?name=${encodeURIComponent(name)}`,
          ),
        );
        for (const network of disconnected)
          await recover(`reconnect-${network}`, () =>
            this.request(
              'POST',
              `/networks/${encodeURIComponent(network)}/connect`,
              { Container: info.Id, EndpointConfig: endpoints[network] },
            ),
          );
      }
      if (info.State.Running) {
        await recover('start', () =>
          this.request('POST', `/containers/${info.Id}/start`),
        );
        await recover('readiness', () => ready(oldPort));
      }
      reportRollback(error);
      throw error;
    }
    try {
      await this.request('DELETE', `/containers/${info.Id}?force=1&v=0`);
    } catch {
      console.warn(
        'Applied configuration; old rollback container requires cleanup',
      );
    }
  }
}
