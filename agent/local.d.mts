export interface LocalManagement {
  request(
    method: string,
    path: string,
    input?: unknown,
  ): Promise<Record<string, unknown>>;
  syncPolicy(): Promise<unknown>;
}
export function createLocalManagement(options: {
  nodeId: string;
  serverToken: string;
  directory: string;
  socket: string;
  containers: { hbbs: string; hbbr: string };
  urls: { hbbs: string; hbbr: string };
}): LocalManagement;
