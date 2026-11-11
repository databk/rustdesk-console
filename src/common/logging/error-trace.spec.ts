import { errorTrace } from './error-trace';

describe('errorTrace', () => {
  it('returns the stack for errors', () => {
    const error = new Error('boom');
    expect(errorTrace(error)).toBe(error.stack);
  });

  it('handles non-error values', () => {
    expect(errorTrace('plain')).toBe('plain');
    expect(errorTrace({ code: 'X' })).toBe('{"code":"X"}');
  });

  it('always returns a string and never throws', () => {
    expect(errorTrace(undefined)).toBe('undefined');
    expect(errorTrace(null)).toBe('null');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(errorTrace(circular)).toBe('[object Object]');
    expect(errorTrace(10n)).toBe('10');
  });
});
