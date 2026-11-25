import { normalizeDeviceUuid } from './device-uuid.util';

describe('normalizeDeviceUuid', () => {
  const canonical = '550e8400-e29b-41d4-a716-446655440000';

  it('keeps canonical UUIDs and lowercases them', () => {
    expect(normalizeDeviceUuid(canonical)).toBe(canonical);
    expect(normalizeDeviceUuid(canonical.toUpperCase())).toBe(canonical);
  });

  it('decodes base64 of a UUID string', () => {
    const encoded = Buffer.from(canonical).toString('base64');
    expect(normalizeDeviceUuid(encoded)).toBe(canonical);
  });

  it('formats base64 of the 16 raw UUID bytes', () => {
    const bytes = Buffer.from(canonical.replace(/-/g, ''), 'hex');
    expect(normalizeDeviceUuid(bytes.toString('base64'))).toBe(canonical);
  });

  it('handles raw bytes whose base64 contains a slash', () => {
    const bytes = Buffer.from('ffffffffffffffffffffffffffffffff', 'hex');
    const encoded = bytes.toString('base64');
    expect(encoded).toContain('/');
    expect(normalizeDeviceUuid(encoded)).toBe(
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    );
  });

  it('formats a compact 32-digit UUID', () => {
    expect(normalizeDeviceUuid(canonical.replace(/-/g, ''))).toBe(canonical);
  });

  it('leaves clone-isolation keys and unknown values unchanged', () => {
    const isolated = 'a'.repeat(64);
    expect(normalizeDeviceUuid(isolated)).toBe(isolated);
    expect(normalizeDeviceUuid('shared-machine-guid')).toBe(
      'shared-machine-guid',
    );
    expect(normalizeDeviceUuid('not base64!')).toBe('not base64!');
    expect(normalizeDeviceUuid('')).toBe('');
  });
});
