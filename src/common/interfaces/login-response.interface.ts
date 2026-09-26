import { UserInfo } from '../../modules/user/entities/user.entity';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/types';

/**
 * Login response interface
 * Defines the data structure returned after a successful login
 * Applies to all authentication methods (password login, TFA, email verification code, OIDC, Passkey, etc.)
 */
export interface LoginResponse {
  /** Access token, returned only on successful login */
  access_token?: string;
  /** Response type, identifies the state of the login flow */
  type: string;
  /** Two-factor authentication type, returned only when TFA is required */
  tfa_type?: string;
  /** Login session identifier (UUID), returned by the server when a second verification step is required and echoed back by the client in subsequent requests to track one login */
  secret?: string;
  /** Passkey authentication options, returned only when Passkey verification is required, for the browser to call navigator.credentials.get() */
  passkey_options?: PublicKeyCredentialRequestOptionsJSON;
  /** User info */
  user?: {
    /** Stable database identifier */
    guid: string;
    /** Username */
    name: string;
    /** Display name */
    display_name?: string;
    /** Avatar URL */
    avatar?: string;
    /** Email address */
    email?: string;
    /** User note */
    note?: string;
    /** User status */
    status: number;
    /** User info settings */
    info?: UserInfo;
    /** Whether the user is an administrator */
    is_admin: boolean;
    /** Third-party authentication type */
    third_auth_type?: string;
  };
}
