export type SessionErrorCode =
  | 'configuration'
  | 'authorization'
  | 'sessionExpired'
  | 'identity'
  | 'encryption'
  | 'transport'
  | 'timeout'
  | 'cancelled'
  | 'overload'
  | 'protocol'
  | 'offline'
  | 'password'
  | 'denied';

// Do not attach received packets, credentials or raw server messages to errors.
export class SessionError extends Error {
  constructor(readonly code: SessionErrorCode) {
    super(`Web client: ${code}`);
    this.name = 'SessionError';
  }
}
