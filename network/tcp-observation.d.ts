export type TcpReason =
  | 'permission_denied'
  | 'tool_unavailable'
  | 'source_unavailable'
  | 'invalid_response'
  | 'platform_unobservable'
  | 'namespace_unobservable'
  | 'proxy_unobservable'
  | 'connection_not_found'
  | 'ambiguous_connection'
  | 'not_connected'
  | 'not_tcp'
  | 'system_selected';
export interface TcpEnvironment {
  system: 'linux' | 'windows' | 'macos' | 'unknown';
  release: string | null;
  deployment: 'native' | 'container' | 'kubernetes' | 'unknown';
  network_mode: 'host' | 'bridge' | 'isolated' | 'unknown';
  scope: 'host' | 'container' | 'namespace' | 'unknown';
  source: 'sysctl' | 'ss' | 'powershell' | 'unobserved';
}
export interface TcpObservation {
  api_version: 1;
  kind: 'system' | 'connection';
  status: 'identified' | 'mixed' | 'unavailable' | 'not_applicable';
  algorithm: string | null;
  algorithms: string[];
  algorithms_verified: boolean;
  profiles: { name: string; algorithm: string | null }[];
  reason: TcpReason | null;
  environment: TcpEnvironment;
  observed_at: string;
}
export interface TcpTuple {
  local: { address: string; port: number };
  remote: { address: string; port: number };
}
export function unknownEnvironment(): TcpEnvironment;
export function unavailable(
  kind: TcpObservation['kind'],
  reason: TcpReason,
  environment?: TcpEnvironment,
): TcpObservation;
export function parseObservation(value: unknown): TcpObservation | undefined;
export function validTuple(value: unknown): value is TcpTuple;
export function socketTuple(
  socket: import('node:net').Socket | undefined,
): TcpTuple | undefined;
export function reverseTuple(tuple: TcpTuple): TcpTuple;
export function connectionArgs(tuple: TcpTuple): string[];
export function parseSocket(
  output: string,
  tuple: TcpTuple,
  requiredProcess?: 'hbbr',
): { algorithm: string | null; reason: TcpReason | null };
export function createObserver(options?: Record<string, unknown>): {
  system(): Promise<TcpObservation>;
  connection(
    tuple: TcpTuple,
    requiredProcess?: 'hbbr',
  ): Promise<TcpObservation>;
  environment(source?: TcpEnvironment['source']): Promise<TcpEnvironment>;
};
