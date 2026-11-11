import { resolveLogLevels } from './log-level.util';

describe('resolveLogLevels', () => {
  it('defaults to log and above when unset or empty', () => {
    const expected = ['log', 'warn', 'error', 'fatal'];
    expect(resolveLogLevels(undefined)).toEqual(expected);
    expect(resolveLogLevels('')).toEqual(expected);
  });

  it('falls back to the default for unknown values', () => {
    expect(resolveLogLevels('loud')).toEqual(['log', 'warn', 'error', 'fatal']);
  });

  it('treats the value as a minimum threshold', () => {
    expect(resolveLogLevels('debug')).toEqual([
      'debug',
      'log',
      'warn',
      'error',
      'fatal',
    ]);
    expect(resolveLogLevels('error')).toEqual(['error', 'fatal']);
    expect(resolveLogLevels('verbose')).toHaveLength(6);
  });

  it('accepts aliases and is case-insensitive', () => {
    expect(resolveLogLevels(' INFO ')).toEqual([
      'log',
      'warn',
      'error',
      'fatal',
    ]);
    expect(resolveLogLevels('Warning')).toEqual(['warn', 'error', 'fatal']);
    expect(resolveLogLevels('trace')).toHaveLength(6);
  });
});
