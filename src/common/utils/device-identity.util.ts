import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { Peer } from '../entities/peer.entity';
import { normalizeDeviceUuid } from './device-uuid.util';

/** Console-only key. Never send this value to hbbs or change the client's UUID. */
export function isolatedDeviceUuid(uuid: string, id: string): string {
  const hex = createHash('sha256')
    .update(JSON.stringify(['rustdesk-console/device/v1', uuid, id]))
    .digest('hex');
  return hex;
}

/**
 * Resolve the Console key for a client-reported UUID.
 *
 * The client UUID is normalised to the canonical UUID text so the Console
 * never stores base64 (which can contain `/`) in a path identifier. Legacy
 * rows are still honoured during the upgrade:
 * - clone-isolation keys keep the original client text as their hash input,
 *   so existing isolated rows and tombstones continue to match;
 * - a pre-migration base64 row is reused when the canonical row is missing.
 */
export async function resolveDeviceUuid(
  peers: Repository<Peer>,
  uuid: string,
  id: string,
  enabled: boolean,
): Promise<string> {
  const canonical = normalizeDeviceUuid(uuid);

  if (!enabled) {
    if (canonical === uuid) return uuid;
    const canonicalPeer = await peers.findOne({ where: { uuid: canonical } });
    if (canonicalPeer) return canonical;
    const legacy = await peers.findOne({ where: { uuid } });
    return legacy?.id === id ? uuid : canonical;
  }

  // Keep hashing the client-reported text. Changing the hash input would
  // orphan every existing clone-isolation row and tombstone.
  const isolated = isolatedDeviceUuid(uuid, id);
  const existing = await peers.findOne({ where: { uuid: isolated } });
  if (existing) return isolated;

  const legacy = await peers.findOne({ where: { uuid: canonical } });
  if (legacy?.id === id) return canonical;
  if (canonical !== uuid) {
    const rawLegacy = await peers.findOne({ where: { uuid } });
    if (rawLegacy?.id === id) return uuid;
  }
  return isolated;
}
