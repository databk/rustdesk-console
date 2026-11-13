import { withDefaultApiServer } from './nexus-api-server.util';

describe('withDefaultApiServer', () => {
  it('injects the console origin into default-settings', () => {
    const custom = {};

    expect(
      withDefaultApiServer(custom, 'https://console.example.com/login'),
    ).toEqual({
      'default-settings': {
        'api-server': 'https://console.example.com',
      },
    });
  });

  it('keeps an explicit override api-server untouched', () => {
    const custom = {
      'override-settings': {
        'api-server': 'https://custom.example.com',
      },
    };

    expect(withDefaultApiServer(custom, 'https://console.example.com')).toBe(
      custom,
    );
  });

  it('keeps an explicit default api-server untouched', () => {
    const custom = {
      'default-settings': {
        'api-server': 'https://custom.example.com',
      },
    };

    expect(withDefaultApiServer(custom, 'https://console.example.com')).toBe(
      custom,
    );
  });

  it('fills an empty api-server value', () => {
    const custom = {
      'default-settings': {
        'api-server': '   ',
        'relay-server': 'relay.example.com:21117',
      },
    };

    expect(withDefaultApiServer(custom, 'https://console.example.com')).toEqual(
      {
        'default-settings': {
          'api-server': 'https://console.example.com',
          'relay-server': 'relay.example.com:21117',
        },
      },
    );
  });

  it('preserves unrelated default-settings', () => {
    const custom = {
      'default-settings': {
        'relay-server': 'relay.example.com:21117',
      },
    };

    expect(withDefaultApiServer(custom, 'https://console.example.com')).toEqual(
      {
        'default-settings': {
          'relay-server': 'relay.example.com:21117',
          'api-server': 'https://console.example.com',
        },
      },
    );
  });

  it('does nothing without a usable frontendUrl', () => {
    const custom = {};

    expect(withDefaultApiServer(custom, '')).toBe(custom);
    expect(withDefaultApiServer(custom, 'not-a-url')).toBe(custom);
    expect(withDefaultApiServer(custom, 'ftp://console.example.com')).toBe(
      custom,
    );
  });

  it('keeps plain-HTTP deployments working', () => {
    expect(
      withDefaultApiServer({}, 'http://console.example.com:21114'),
    ).toEqual({
      'default-settings': {
        'api-server': 'http://console.example.com:21114',
      },
    });
  });
});
