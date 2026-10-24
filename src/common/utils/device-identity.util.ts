import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { Peer } from '../entities/peer.entity';

export function cloneIsolationEnabled(): boolean {
  return process.env.DEVICE_CLONE_ISOLATION === 'true';
}

/** Console-only key. Never send this value to hbbs or change the client's UUID. */
export function isolatedDeviceUuid(uuid: string, id: string): string {
  const hex = createHash('sha256')
    .update(JSON.stringify(['rustdesk-console/device/v1', uuid, id]))
    .digest('hex');
  return hex;
}

/** Preserve legacy rows only when BOTH the UUID and the RustDesk ID match. */
export async function resolveDeviceUuid(
  peers: Repository<Peer>,
  uuid: string,
  id: string,
): Promise<string> {
  if (!cloneIsolationEnabled()) return uuid;
  const isolated = isolatedDeviceUuid(uuid, id);
  const existing = await peers.findOne({ where: { uuid: isolated } });
  if (existing) return isolated;
  const legacy = await peers.findOne({ where: { uuid } });
  return legacy?.id === id ? uuid : isolated;
}
