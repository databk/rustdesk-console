import type { Repository } from 'typeorm';
import type { Peer } from '../entities/peer.entity';
import { isolatedDeviceUuid, resolveDeviceUuid } from './device-identity.util';

const canonical = '550e8400-e29b-41d4-a716-446655440000';
const legacy = Buffer.from(canonical.replace(/-/g, ''), 'hex').toString(
  'base64',
);

function repository(rows: Array<Partial<Peer>>): Repository<Peer> {
  return {
    findOne: jest.fn(({ where }: { where: { uuid: string } }) =>
      Promise.resolve(
        (rows.find((row) => row.uuid === where.uuid) as Peer | undefined) ??
          null,
      ),
    ),
  } as unknown as Repository<Peer>;
}

describe('resolveDeviceUuid', () => {
  it('returns the canonical UUID when no legacy row exists', async () => {
    await expect(
      resolveDeviceUuid(repository([]), legacy, 'host-a', false),
    ).resolves.toBe(canonical);
  });

  it('keeps a pre-migration base64 row with the same RustDesk ID', async () => {
    await expect(
      resolveDeviceUuid(
        repository([{ uuid: legacy, id: 'host-a' }]),
        legacy,
        'host-a',
        false,
      ),
    ).resolves.toBe(legacy);
  });

  it('prefers an existing canonical row', async () => {
    await expect(
      resolveDeviceUuid(
        repository([{ uuid: canonical, id: 'host-a' }]),
        legacy,
        'host-a',
        false,
      ),
    ).resolves.toBe(canonical);
  });

  it('keeps hashing the client text for existing isolation keys', async () => {
    const isolated = isolatedDeviceUuid(legacy, 'host-a');
    await expect(
      resolveDeviceUuid(
        repository([{ uuid: isolated, id: 'host-a' }]),
        legacy,
        'host-a',
        true,
      ),
    ).resolves.toBe(isolated);
  });
});
