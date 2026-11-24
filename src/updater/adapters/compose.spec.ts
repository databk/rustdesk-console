import {
  ComposeContainerInfo,
  ComposeServiceConfig,
  composeFilesMatch,
  verifyServiceInstance,
} from './compose';

function container(
  overrides: Partial<ComposeContainerInfo> = {},
): ComposeContainerInfo {
  return {
    Id: 'a'.repeat(64),
    Image: 'sha256:' + 'b'.repeat(64),
    State: { Running: true },
    Config: {
      Image: 'example/backend:latest',
      Labels: {},
      Env: ['PORT=3000', 'DB_TYPE=sqlite'],
      Cmd: ['node', '/app/main.js'],
      Entrypoint: null,
    },
    Mounts: [
      {
        Type: 'bind',
        Source: '/srv/console/data',
        Destination: '/data',
        RW: true,
      },
      {
        Type: 'volume',
        Source: '/var/lib/docker/volumes/console-config/_data',
        Destination: '/config',
        RW: false,
      },
    ],
    ...overrides,
  };
}

const service: ComposeServiceConfig = {
  image: 'example/backend:latest',
  environment: { PORT: '3000', DB_TYPE: 'sqlite' },
  volumes: [
    { type: 'bind', source: '/srv/console/data', target: '/data' },
    {
      type: 'volume',
      source: 'console-config',
      target: '/config',
      read_only: true,
    },
  ],
  command: ['node', '/app/main.js'],
};

describe('live Compose service verification', () => {
  test('accepts a container that matches the effective definition', () => {
    expect(verifyServiceInstance(service, container())).toBeNull();
  });

  test('reports image drift', () => {
    expect(
      verifyServiceInstance(
        { ...service, image: 'example/backend:next' },
        container(),
      ),
    ).toBe('The running service image differs from the Compose configuration.');
  });

  test('reports environment drift', () => {
    expect(
      verifyServiceInstance(
        { ...service, environment: { PORT: '3001' } },
        container(),
      ),
    ).toBe(
      'The running service environment differs from the Compose configuration.',
    );
  });

  test('reports bind mount source and read-only drift', () => {
    expect(
      verifyServiceInstance(
        {
          ...service,
          volumes: [{ type: 'bind', source: '/srv/other', target: '/data' }],
        },
        container(),
      ),
    ).toBe('The running service mounts differ from the Compose configuration.');
    expect(
      verifyServiceInstance(
        {
          ...service,
          volumes: [
            {
              type: 'bind',
              source: '/srv/console/data',
              target: '/data',
              read_only: true,
            },
          ],
        },
        container(),
      ),
    ).toBe('The running service mounts differ from the Compose configuration.');
  });

  test('reports a missing mount and command drift', () => {
    expect(
      verifyServiceInstance(
        {
          ...service,
          volumes: [
            { type: 'volume', source: 'console-config', target: '/missing' },
          ],
        },
        container(),
      ),
    ).toBe('The running service mounts differ from the Compose configuration.');
    expect(
      verifyServiceInstance(
        { ...service, command: ['node', '/app/other.js'] },
        container(),
      ),
    ).toBe(
      'The running service command differs from the Compose configuration.',
    );
  });
});

describe('Compose file list comparison', () => {
  test('accepts absolute, relative, and missing older labels', () => {
    const files = ['/srv/console/docker-compose.yml'];
    expect(composeFilesMatch(files[0], '/srv/console', files)).toBe(true);
    expect(composeFilesMatch('docker-compose.yml', '/srv/console', files)).toBe(
      true,
    );
    expect(composeFilesMatch(undefined, '/srv/console', files)).toBe(true);
  });

  test('rejects a different file list or order', () => {
    const files = [
      '/srv/console/docker-compose.yml',
      '/srv/console/docker-compose.override.yml',
    ];
    expect(
      composeFilesMatch(
        'docker-compose.override.yml,docker-compose.yml',
        '/srv/console',
        files,
      ),
    ).toBe(false);
    expect(
      composeFilesMatch(
        '/srv/console/docker-compose.yml',
        '/srv/console',
        files,
      ),
    ).toBe(false);
  });
});
