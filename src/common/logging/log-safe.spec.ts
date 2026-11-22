import { logSafe } from './log-safe';

describe('logSafe', () => {
  it('leaves ordinary values unchanged', () => {
    expect(logSafe('alice@example.com')).toBe('alice@example.com');
  });

  it('replaces line breaks and other control characters', () => {
    const lineSeparator = String.fromCharCode(0x2028);
    expect(
      logSafe(`bob\r\nWARN [AuthService] forged\tline${lineSeparator}x`),
    ).toBe('bob??WARN [AuthService] forged?line?x');
  });

  it('truncates long values', () => {
    expect(logSafe('a'.repeat(200))).toBe(`${'a'.repeat(64)}...`);
    expect(logSafe('abcdef', 3)).toBe('abc...');
  });

  it('stringifies non-string values', () => {
    expect(logSafe(undefined)).toBe('undefined');
    expect(logSafe(42)).toBe('42');
  });
});
