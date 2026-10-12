import assert from 'node:assert/strict';
import { test } from 'node:test';
import tcp from './tcp-observation.js';

const tuple = {
  local: { address: '127.0.0.1', port: 21119 },
  remote: { address: '127.0.0.1', port: 53000 },
};
const missing = () => Object.assign(new Error('Missing'), { code: 'ENOENT' });
function linux(files = {}, options = {}) {
  return tcp.createObserver({
    platform: 'linux',
    release: '6.8',
    readFile: async (file) => {
      if (Object.hasOwn(files, file)) return files[file];
      throw missing();
    },
    readlink: async () => 'net:[1]',
    ...options,
  });
}
test('reads the namespace current value and every registered name, without BBR preference or writes', async () => {
  const value = await linux({
    '/proc/sys/net/ipv4/tcp_congestion_control': 'reno\n',
    '/proc/sys/net/ipv4/tcp_available_congestion_control':
      'reno cubic bbr vegas custom_cc',
  }).system();
  assert.equal(value.algorithm, 'reno');
  assert.equal(value.status, 'identified');
  assert.deepEqual(value.algorithms, [
    'reno',
    'cubic',
    'bbr',
    'vegas',
    'custom_cc',
  ]);
  assert.equal(value.algorithms_verified, true);
  assert.equal(tcp.parseObservation(value)?.algorithm, 'reno');
  assert.ok(!Object.hasOwn(value, 'configured_algorithm'));
});
test('container/Kubernetes markers do not pretend to identify bridge mode or the host', async () => {
  const files = {
    '/proc/sys/net/ipv4/tcp_congestion_control': 'cubic',
    '/.dockerenv': '',
  };
  const docker = await linux(files).system();
  assert.equal(docker.environment.deployment, 'container');
  assert.equal(docker.environment.scope, 'container');
  assert.equal(docker.environment.network_mode, 'unknown');
  const kube = await linux({
    ...files,
    '/proc/1/cgroup': '0::/kubepods/pod',
  }).system();
  assert.equal(kube.environment.deployment, 'kubernetes');
});
test('a denied registry read does not erase the independently verified current value', async () => {
  const value = await linux({
    '/proc/sys/net/ipv4/tcp_congestion_control': 'custom_cc',
  }).system();
  assert.equal(value.algorithm, 'custom_cc');
  assert.equal(value.algorithms_verified, false);
  assert.deepEqual(value.algorithms, []);
});
test('permissions and an isolated native namespace have explicit truthful observations', async () => {
  const value = await linux(
    {},
    {
      readFile: async () => {
        throw Object.assign(new Error(), { code: 'EACCES' });
      },
      readlink: async (file) => (file.includes('self') ? 'net:[2]' : 'net:[1]'),
    },
  ).system();
  assert.equal(value.reason, 'permission_denied');
  assert.equal(value.algorithm, null);
  assert.equal(value.environment.scope, 'namespace');
});
test('actual connection uses its exact sending tuple and never a sysctl fallback', async () => {
  const commands = [];
  const observer = linux(
    { '/proc/sys/net/ipv4/tcp_congestion_control': 'bbr' },
    {
      execute: async (file, args, options) => {
        commands.push({ file, args, options });
        return {
          stdout:
            '0 0 127.0.0.1:21119 127.0.0.1:53000 users:(("hbbr",pid=1,fd=4))\n\t ts sack cubic wscale:7,7 rtt:50/2 send 10Mbps pacing_rate 20Mbps\n',
        };
      },
    },
  );
  const value = await observer.connection(tuple, 'hbbr');
  assert.equal(value.algorithm, 'cubic');
  assert.equal(commands[0].file, 'ss');
  assert.ok(commands[0].args.includes(':21119'));
  assert.ok(commands[0].args.includes(':53000'));
  assert.equal(commands[0].options.timeout, 2500);
  assert.equal(
    tcp.parseSocket(
      commands.length
        ? '0 0 127.0.0.1:53000 127.0.0.1:21119\n bbr rtt:50\n'
        : '',
      tuple,
    ).algorithm,
    null,
  );
});
test('a proxy process must not masquerade as the hbbr sending socket', () => {
  const output =
    '0 0 127.0.0.1:21119 127.0.0.1:53000 users:(("nginx",pid=1,fd=4))\n bbr rtt:50\n';
  assert.equal(tcp.parseSocket(output, tuple, 'hbbr').algorithm, null);
});
test('matching supports compressed IPv6 and IPv4-mapped IPv6, and rejects ambiguous sockets', () => {
  const mapped =
    '0 0 [::ffff:7f00:1]:21119 [::ffff:127.0.0.1]:53000\n cubic rtt:2\n';
  assert.equal(tcp.parseSocket(mapped, tuple).algorithm, 'cubic');
  const v6 = {
    local: { address: '2001:db8::1', port: 1 },
    remote: { address: '2001:db8::2', port: 2 },
  };
  assert.equal(
    tcp.parseSocket(
      '0 0 [2001:db8:0:0:0:0:0:1]:1 [2001:db8::2]:2\n bbr wscale:1\n',
      v6,
    ).algorithm,
    'bbr',
  );
  assert.equal(
    tcp.parseSocket(mapped + mapped, tuple).reason,
    'ambiguous_connection',
  );
});
test('unavailable tools and missing connections are distinguished', async () => {
  const value = await linux(
    {},
    {
      execute: async () => {
        throw missing();
      },
    },
  ).connection(tuple);
  assert.equal(value.reason, 'tool_unavailable');
  assert.equal(value.algorithm, null);
  assert.equal(tcp.parseSocket('', tuple).reason, 'connection_not_found');
});
test('Windows current templates can differ; template defaults do not become actual connection algorithms', async () => {
  const observer = tcp.createObserver({
    platform: 'win32',
    release: '10.0.26100',
    execute: async (file, args) => {
      assert.equal(file, 'powershell.exe');
      assert.ok(args.at(-1).includes('Get-NetTCPSetting'));
      assert.ok(!args.at(-1).includes('Set-'));
      return {
        stdout: JSON.stringify([
          { SettingName: 'Internet', CongestionProvider: 'CUBIC' },
          { SettingName: 'Datacenter', CongestionProvider: 'DCTCP' },
        ]),
      };
    },
  });
  const value = await observer.system();
  assert.equal(value.status, 'mixed');
  assert.equal(value.algorithm, null);
  assert.equal(value.profiles[0].algorithm, 'cubic');
  assert.equal(tcp.parseObservation(value)?.status, 'mixed');
  assert.equal(
    (await observer.connection(tuple)).reason,
    'platform_unobservable',
  );
});
test('an unresolved Windows template or macOS dynamic policy is not guessed from OS version', async () => {
  const windows = await tcp
    .createObserver({
      platform: 'win32',
      execute: async () => ({
        stdout: '[{"SettingName":"Internet","CongestionProvider":"Default"}]',
      }),
    })
    .system();
  assert.equal(windows.reason, 'system_selected');
  const mac = await tcp
    .createObserver({
      platform: 'darwin',
      execute: async () => ({ stdout: '0' }),
    })
    .system();
  assert.equal(mac.reason, 'system_selected');
  assert.equal(mac.algorithm, null);
});
test('response parser rejects claimed connection defaults and inconsistent success/unknown states', () => {
  const empty = tcp.unavailable('connection', 'source_unavailable');
  assert.equal(tcp.parseObservation({ ...empty, algorithm: 'bbr' }), undefined);
  assert.equal(
    tcp.parseObservation({ ...empty, status: 'identified', algorithm: 'bbr' }),
    undefined,
  );
  assert.equal(
    tcp.parseObservation({
      ...empty,
      scope: 'host_new_tcp_connections',
      api_version: 2,
    }),
    undefined,
  );
  const good = {
    ...empty,
    status: 'identified',
    algorithm: 'custom_cc',
    reason: null,
    secret: 'hidden',
  };
  assert.ok(tcp.parseObservation(good));
  assert.ok(!Object.hasOwn(tcp.parseObservation(good), 'secret'));
});
