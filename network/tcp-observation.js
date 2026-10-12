'use strict';

// Shared by Console and its existing management agent. Every operation is read-only.
const fs = require('node:fs/promises');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { isIP } = require('node:net');
const run = promisify(execFile);
const algorithmPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const reasons = [
  null,
  'permission_denied',
  'tool_unavailable',
  'source_unavailable',
  'invalid_response',
  'platform_unobservable',
  'namespace_unobservable',
  'proxy_unobservable',
  'connection_not_found',
  'ambiguous_connection',
  'not_connected',
  'not_tcp',
  'system_selected',
];
const systems = ['linux', 'windows', 'macos', 'unknown'];
const deployments = ['native', 'container', 'kubernetes', 'unknown'];
const scopes = ['host', 'container', 'namespace', 'unknown'];
const sources = ['sysctl', 'ss', 'powershell', 'unobserved'];

const unknownEnvironment = () => ({
  system: 'unknown',
  release: null,
  deployment: 'unknown',
  network_mode: 'unknown',
  scope: 'unknown',
  source: 'unobserved',
});
const unavailable = (kind, reason, environment = unknownEnvironment()) => ({
  api_version: 1,
  kind,
  status: 'unavailable',
  algorithm: null,
  algorithms: [],
  algorithms_verified: false,
  profiles: [],
  reason,
  environment,
  observed_at: new Date().toISOString(),
});
const validAlgorithm = (value) =>
  typeof value === 'string' && algorithmPattern.test(value);
const validTuple = (value) =>
  value &&
  ['local', 'remote'].every(
    (side) =>
      value[side] &&
      isIP(value[side].address) &&
      Number.isInteger(value[side].port) &&
      value[side].port > 0 &&
      value[side].port <= 65535,
  );
const normalizeAddress = (address) => {
  let value = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (value.startsWith('::ffff:') && isIP(value.slice(7)) === 4)
    value = value.slice(7);
  if (isIP(value) === 6) {
    const [address, zone] = value.split('%');
    value = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(value);
    if (mapped) {
      const high = parseInt(mapped[1], 16),
        low = parseInt(mapped[2], 16);
      value = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    } else if (zone) value += `%${zone}`;
  }
  return value;
};
const reverseTuple = (tuple) => ({ local: tuple.remote, remote: tuple.local });
const socketTuple = (socket) => {
  const value = {
    local: { address: socket?.localAddress, port: socket?.localPort },
    remote: { address: socket?.remoteAddress, port: socket?.remotePort },
  };
  return validTuple(value) && !socket.destroyed ? value : undefined;
};

function parseObservation(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.api_version !== 1 ||
    !['system', 'connection'].includes(value.kind) ||
    !['identified', 'mixed', 'unavailable', 'not_applicable'].includes(
      value.status,
    ) ||
    !reasons.includes(value.reason) ||
    !(value.algorithm === null || validAlgorithm(value.algorithm)) ||
    !Array.isArray(value.algorithms) ||
    value.algorithms.length > 128 ||
    !value.algorithms.every(validAlgorithm) ||
    new Set(value.algorithms).size !== value.algorithms.length ||
    typeof value.algorithms_verified !== 'boolean' ||
    !Array.isArray(value.profiles) ||
    value.profiles.length > 32 ||
    !value.profiles.every(
      (p) =>
        p &&
        typeof p.name === 'string' &&
        /^[a-zA-Z0-9 _.-]{1,64}$/.test(p.name) &&
        (p.algorithm === null || validAlgorithm(p.algorithm)),
    ) ||
    typeof value.observed_at !== 'string' ||
    !Number.isFinite(Date.parse(value.observed_at))
  )
    return undefined;
  const e = value.environment;
  if (
    !e ||
    !systems.includes(e.system) ||
    !deployments.includes(e.deployment) ||
    !scopes.includes(e.scope) ||
    !sources.includes(e.source) ||
    !['host', 'bridge', 'isolated', 'unknown'].includes(e.network_mode) ||
    !(
      e.release === null ||
      (typeof e.release === 'string' &&
        e.release.length <= 128 &&
        !/[\u0000-\u001f]/.test(e.release))
    )
  )
    return undefined;
  if (
    value.status === 'identified'
      ? !value.algorithm || value.reason !== null
      : value.algorithm !== null
  )
    return undefined;
  if (value.status === 'unavailable' && !value.reason) return undefined;
  if (
    value.status === 'mixed' &&
    (value.kind !== 'system' ||
      value.reason !== null ||
      value.profiles.length < 2)
  )
    return undefined;
  if (
    value.status === 'not_applicable' &&
    (value.kind !== 'connection' || value.reason !== 'not_tcp')
  )
    return undefined;
  // Rebuild the response: upstream fields must never become an unrestricted metadata channel.
  return {
    api_version: 1,
    kind: value.kind,
    status: value.status,
    algorithm: value.algorithm,
    algorithms: [...value.algorithms],
    algorithms_verified: value.algorithms_verified,
    profiles: value.profiles.map((p) => ({
      name: p.name,
      algorithm: p.algorithm,
    })),
    reason: value.reason,
    environment: {
      system: e.system,
      release: e.release,
      deployment: e.deployment,
      network_mode: e.network_mode,
      scope: e.scope,
      source: e.source,
    },
    observed_at: value.observed_at,
  };
}

function errorReason(error) {
  if (
    ['EACCES', 'EPERM'].includes(error?.code) ||
    /permission denied|operation not permitted/i.test(error?.stderr || '')
  )
    return 'permission_denied';
  if (error?.code === 'ENOENT') return 'tool_unavailable';
  return 'source_unavailable';
}

function createObserver({
  platform = process.platform,
  release = os.release(),
  readFile = fs.readFile,
  readlink = fs.readlink,
  execute = run,
} = {}) {
  const command = async (file, args) => {
    const result = await execute(file, args, {
      timeout: 2500,
      maxBuffer: 256 * 1024,
      windowsHide: true,
      env: { ...process.env, LC_ALL: 'C' },
    });
    return String(result.stdout).trim();
  };
  const read = async (file) => String(await readFile(file, 'utf8')).trim();
  const exists = async (file) => {
    try {
      await readFile(file);
      return true;
    } catch {
      return false;
    }
  };
  async function environment(source = 'unobserved') {
    const system =
      { linux: 'linux', win32: 'windows', darwin: 'macos' }[platform] ||
      'unknown';
    const e = {
      system,
      release,
      deployment: 'native',
      network_mode: 'unknown',
      scope: 'host',
      source,
    };
    if (platform === 'linux') {
      let cgroup = '';
      try {
        cgroup = await read('/proc/1/cgroup');
      } catch {
        /* Optional deployment evidence. */
      }
      const kubernetes =
        /kubepods/.test(cgroup) ||
        (await exists(
          '/var/run/secrets/kubernetes.io/serviceaccount/namespace',
        ));
      const container =
        kubernetes ||
        /docker|containerd|libpod|lxc/.test(cgroup) ||
        (await exists('/.dockerenv')) ||
        (await exists('/run/.containerenv'));
      if (container) {
        e.deployment = kubernetes ? 'kubernetes' : 'container';
        e.scope = 'container';
        // A marker proves a container, not its bridge/host network mode.
      } else {
        try {
          if (
            (await readlink('/proc/self/ns/net')) !==
            (await readlink('/proc/1/ns/net'))
          ) {
            e.scope = 'namespace';
            e.network_mode = 'isolated';
          }
        } catch {
          e.scope = 'unknown';
        }
      }
    } else if (system === 'unknown') {
      e.deployment = 'unknown';
      e.scope = 'unknown';
    }
    return e;
  }
  async function system() {
    const e = await environment(platform === 'win32' ? 'powershell' : 'sysctl');
    try {
      if (platform === 'linux') {
        const algorithm = await read(
          '/proc/sys/net/ipv4/tcp_congestion_control',
        );
        if (!validAlgorithm(algorithm))
          return unavailable('system', 'invalid_response', e);
        let algorithms = [];
        let verified = false;
        try {
          algorithms = (
            await read('/proc/sys/net/ipv4/tcp_available_congestion_control')
          ).split(/\s+/);
          verified =
            algorithms.length <= 128 && algorithms.every(validAlgorithm);
          if (!verified) algorithms = [];
        } catch {
          /* The current result remains valid if the registry is unreadable. */
        }
        return {
          ...unavailable('system', 'source_unavailable', e),
          status: 'identified',
          reason: null,
          algorithm,
          algorithms: [...new Set(algorithms)],
          algorithms_verified: verified,
        };
      }
      if (platform === 'win32') {
        const output = await command('powershell.exe', [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$ErrorActionPreference="Stop"; @(Get-NetTCPSetting | Where-Object { $_.SettingName -ne "Automatic" } | Select-Object SettingName,@{Name="CongestionProvider";Expression={ if ($null -ne $_.CongestionProvider) { $_.CongestionProvider.ToString() } else { "Default" } }}) | ConvertTo-Json -Compress',
        ]);
        const result = JSON.parse(output.replace(/^\uFEFF/, ''));
        const items = Array.isArray(result) ? result : [result];
        if (
          !items.length ||
          items.length > 32 ||
          items.some(
            (p) =>
              !p ||
              !/^[a-zA-Z0-9 _.-]{1,64}$/.test(p.SettingName) ||
              !validAlgorithm(p.CongestionProvider),
          )
        )
          return unavailable('system', 'invalid_response', e);
        const profiles = items.map((p) => ({
          name: p.SettingName,
          algorithm: /^(default|automatic|none)$/i.test(p.CongestionProvider)
            ? null
            : p.CongestionProvider.toLowerCase(),
        }));
        const algorithms = [
          ...new Set(profiles.map((p) => p.algorithm).filter(Boolean)),
        ];
        if (profiles.some((p) => p.algorithm === null))
          return {
            ...unavailable('system', 'system_selected', e),
            profiles,
            algorithms,
          };
        return {
          ...unavailable('system', 'source_unavailable', e),
          status: algorithms.length === 1 ? 'identified' : 'mixed',
          reason: null,
          algorithm: algorithms.length === 1 ? algorithms[0] : null,
          profiles,
          algorithms,
          algorithms_verified: false,
        }; // Active templates are not an exhaustive supported-algorithm list.
      }
      if (platform === 'darwin') {
        const configured = await command('sysctl', [
          '-n',
          'net.inet.tcp.use_newreno',
        ]);
        if (configured === '1')
          return {
            ...unavailable('system', 'source_unavailable', e),
            status: 'identified',
            reason: null,
            algorithm: 'newreno',
          };
        // With this flag off, macOS may select CUBIC/Prague according to connection policy.
        // A kernel-version guess is not an observation of that policy's current result.
        return unavailable(
          'system',
          configured === '0' ? 'system_selected' : 'invalid_response',
          e,
        );
      }
      return unavailable('system', 'platform_unobservable', e);
    } catch (error) {
      return unavailable('system', errorReason(error), e);
    }
  }
  async function connection(tuple, requiredProcess) {
    const e = await environment('ss');
    if (!validTuple(tuple))
      return unavailable('connection', 'connection_not_found', e);
    if (platform !== 'linux')
      return unavailable('connection', 'platform_unobservable', {
        ...e,
        source: 'unobserved',
      });
    try {
      const output = await command('ss', connectionArgs(tuple));
      const result = parseSocket(output, tuple, requiredProcess);
      let algorithms = [];
      let verified = false;
      try {
        algorithms = (
          await read('/proc/sys/net/ipv4/tcp_available_congestion_control')
        ).split(/\s+/);
        verified = algorithms.length <= 128 && algorithms.every(validAlgorithm);
        if (!verified) algorithms = [];
      } catch {
        /* The socket observation does not require a registry read. */
      }
      return {
        ...unavailable('connection', result.reason, e),
        status: result.algorithm ? 'identified' : 'unavailable',
        algorithm: result.algorithm,
        reason: result.reason,
        algorithms: [...new Set(algorithms)],
        algorithms_verified: verified,
      };
    } catch (error) {
      return unavailable('connection', errorReason(error), e);
    }
  }
  return { system, connection, environment };
}

function connectionArgs(tuple) {
  if (!validTuple(tuple)) throw new Error('Invalid TCP tuple');
  // execFile argv, never a shell or a command supplied by the user.
  return [
    '-H',
    '-t',
    '-i',
    '-n',
    '-p',
    'state',
    'established',
    '(',
    'sport',
    '=',
    `:${tuple.local.port}`,
    'and',
    'dport',
    '=',
    `:${tuple.remote.port}`,
    ')',
  ];
}
function parseSocket(output, tuple, requiredProcess) {
  if (!validTuple(tuple) || typeof output !== 'string')
    return { algorithm: null, reason: 'invalid_response' };
  const lines = output.split(/\r?\n/);
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].trim().split(/\s+/);
    // With -H and an explicit state filter ss omits the State column.
    const offset = /^\d+$/.test(header[0]) ? 2 : 3;
    const endpoint = (text) => {
      const index = text?.lastIndexOf(':');
      if (!(index > 0)) return undefined;
      try {
        return {
          address: normalizeAddress(text.slice(0, index)),
          port: Number(text.slice(index + 1)),
        };
      } catch {
        return undefined;
      }
    };
    const local = endpoint(header[offset]);
    const remote = endpoint(header[offset + 1]);
    if (
      !local ||
      !remote ||
      local.port !== tuple.local.port ||
      remote.port !== tuple.remote.port ||
      local.address !== normalizeAddress(tuple.local.address) ||
      remote.address !== normalizeAddress(tuple.remote.address)
    )
      continue;
    if (requiredProcess && !lines[i].includes(`(("${requiredProcess}",`)) {
      matches.push(null);
      continue;
    }
    const detail = lines[i + 1]?.trim().split(/\s+/) || [];
    // INET_DIAG_CONG is printed as a bare name before key:value statistics.
    const statistics = detail.findIndex((token) => token.includes(':'));
    const prefix = statistics < 0 ? detail : detail.slice(0, statistics);
    const bare = prefix.filter(
      (token) =>
        validAlgorithm(token) &&
        !['ts', 'sack', 'ecn', 'ecnseen', 'fastopen', 'app_limited'].includes(
          token,
        ),
    );
    matches.push(bare.length === 1 ? bare[0] : null);
  }
  if (matches.length > 1)
    return { algorithm: null, reason: 'ambiguous_connection' };
  if (!matches.length)
    return { algorithm: null, reason: 'connection_not_found' };
  return matches[0]
    ? { algorithm: matches[0], reason: null }
    : {
        algorithm: null,
        reason: requiredProcess
          ? 'namespace_unobservable'
          : 'source_unavailable',
      };
}

module.exports = {
  createObserver,
  parseObservation,
  unavailable,
  unknownEnvironment,
  validTuple,
  socketTuple,
  reverseTuple,
  connectionArgs,
  parseSocket,
  errorReason,
};
