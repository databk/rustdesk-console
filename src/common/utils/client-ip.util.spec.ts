import type { IncomingHttpHeaders } from 'node:http';
import {
  extractClientIp,
  isTrustedProxyEnabled,
  normalizeIp,
} from './client-ip.util';

function request(
  remoteAddress: string | undefined,
  headers: IncomingHttpHeaders = {},
) {
  return { headers, socket: { remoteAddress } };
}

describe('isTrustedProxyEnabled', () => {
  it.each(['true', 'TRUE', ' True ', '1'])('enables on %p', (value) => {
    expect(isTrustedProxyEnabled(value)).toBe(true);
  });

  it.each(['', 'false', '0', 'yes', 'on'])(
    'stays disabled on %p',
    (value) => {
      expect(isTrustedProxyEnabled(value)).toBe(false);
    },
  );

  it('stays disabled when TRUSTED_PROXY is unset', () => {
    const saved = process.env.TRUSTED_PROXY;
    delete process.env.TRUSTED_PROXY;
    try {
      expect(isTrustedProxyEnabled()).toBe(false);
    } finally {
      if (saved === undefined) {
        delete process.env.TRUSTED_PROXY;
      } else {
        process.env.TRUSTED_PROXY = saved;
      }
    }
  });
});

describe('normalizeIp', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    [' 203.0.113.7 ', '203.0.113.7'],
    ['203.0.113.7:51234', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8::1', '2001:db8::1'],
    ['[2001:db8::1]', '2001:db8::1'],
    ['[2001:db8::1]:443', '2001:db8::1'],
  ])('normalizes %p to %p', (value, expected) => {
    expect(normalizeIp(value)).toBe(expected);
  });

  it.each([undefined, '', 'unknown', 'example.com', '203.0.113.300'])(
    'rejects %p',
    (value) => {
      expect(normalizeIp(value)).toBeNull();
    },
  );
});

describe('extractClientIp', () => {
  it('uses the socket address and ignores forwarded headers by default', () => {
    expect(
      extractClientIp(
        request('::ffff:172.18.0.3', { 'x-forwarded-for': '198.51.100.9' }),
        false,
      ),
    ).toBe('172.18.0.3');
  });

  it('uses the right-most forwarded entry behind a trusted proxy', () => {
    expect(
      extractClientIp(
        request('172.18.0.3', {
          'x-forwarded-for': '10.0.0.1, 198.51.100.9',
        }),
        true,
      ),
    ).toBe('198.51.100.9');
  });

  it('ignores a client-supplied left-most entry behind a trusted proxy', () => {
    expect(
      extractClientIp(
        request('172.18.0.3', { 'x-forwarded-for': '1.2.3.4,203.0.113.7' }),
        true,
      ),
    ).toBe('203.0.113.7');
  });

  it('reads repeated forwarded headers in order', () => {
    expect(
      extractClientIp(
        request('172.18.0.3', {
          'x-forwarded-for': ['1.2.3.4', '2001:db8::1'],
        }),
        true,
      ),
    ).toBe('2001:db8::1');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['malformed', '198.51.100.9, not-an-ip'],
    ['trailing comma', '198.51.100.9,'],
  ])(
    'falls back to the socket address when the header is %s',
    (_case, header) => {
      expect(
        extractClientIp(
          request(
            '172.18.0.3',
            header === undefined ? {} : { 'x-forwarded-for': header },
          ),
          true,
        ),
      ).toBe('172.18.0.3');
    },
  );

  it('returns null when no address is known', () => {
    expect(extractClientIp({ headers: {} }, false)).toBeNull();
  });
});
