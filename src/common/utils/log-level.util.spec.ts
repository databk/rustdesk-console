import { isValidLogLevel, resolveLogLevels } from './log-level.util';

describe('resolveLogLevels', () => {
  it('defaults to log and above when unset or empty', () => {
    const expected = ['log', 'warn', 'error', 'fatal'];
    expect(resolveLogLevels(undefined)).toEqual(expected);
    expect(resolveLogLevels('')).toEqual(expected);
    expect(resolveLogLevels('   ')).toEqual(expected);
  });

  it.each([
    ['verbose', ['verbose', 'debug', 'log', 'warn', 'error', 'fatal']],
    ['debug', ['debug', 'log', 'warn', 'error', 'fatal']],
    ['log', ['log', 'warn', 'error', 'fatal']],
    ['info', ['log', 'warn', 'error', 'fatal']],
    ['warn', ['warn', 'error', 'fatal']],
    ['error', ['error', 'fatal']],
    ['fatal', ['fatal']],
  ])('maps %s to the minimum level', (value, expected) => {
    expect(resolveLogLevels(value)).toEqual(expected);
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(resolveLogLevels(' WARN ')).toEqual(['warn', 'error', 'fatal']);
    expect(resolveLogLevels('Info')).toEqual(['log', 'warn', 'error', 'fatal']);
  });

  it('falls back to log for unknown values', () => {
    expect(resolveLogLevels('trace')).toEqual([
      'log',
      'warn',
      'error',
      'fatal',
    ]);
  });
});

describe('isValidLogLevel', () => {
  it('accepts unset values and every supported level', () => {
    for (const value of [undefined, '', 'info', 'DEBUG', ' error ', 'fatal']) {
      expect(isValidLogLevel(value)).toBe(true);
    }
  });

  it('rejects unknown values', () => {
    expect(isValidLogLevel('trace')).toBe(false);
  });
});
