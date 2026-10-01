import { readFileSync } from 'node:fs';
import { atomicWrite, missing } from './io';
import { UpdateError } from './errors';
export interface MaintenanceState {
  schemaVersion: 1;
  jobId: string;
  active: boolean;
  allowStart: boolean;
}
export function maintenancePath(): string | undefined {
  return process.env.SYSTEM_UPDATE_MAINTENANCE_FILE;
}
export function readMaintenance(
  path = maintenancePath(),
): MaintenanceState | null {
  if (!path) return null;
  try {
    const state = JSON.parse(readFileSync(path, 'utf8')) as MaintenanceState;
    if (
      state.schemaVersion !== 1 ||
      typeof state.active !== 'boolean' ||
      typeof state.allowStart !== 'boolean'
    )
      throw new Error('invalid maintenance state');
    return state;
  } catch (error: unknown) {
    if (missing(error)) return null;
    throw new UpdateError(
      'MAINTENANCE_STATE_INVALID',
      'The persistent maintenance fence is unreadable.',
    );
  }
}
export function businessWritesAllowed(): boolean {
  try {
    return !readMaintenance()?.active;
  } catch {
    return false;
  }
}
/** 在任何业务模块/ORM 导入前等待，避免断电后 synchronize 越过快照边界。 */
export async function waitForApplicationStart(): Promise<void> {
  for (;;) {
    const state = readMaintenance();
    if (!state?.active || state.allowStart) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
export async function writeMaintenance(
  path: string,
  jobId: string,
  active: boolean,
  allowStart: boolean,
): Promise<void> {
  await atomicWrite(
    path,
    { schemaVersion: 1, jobId, active, allowStart } satisfies MaintenanceState,
    0o644,
  );
}
