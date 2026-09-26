/**
 * Auth module constants
 * Centralizes login-related configuration to avoid magic numbers and scattered string literals
 */

/** JWT token validity period (days) */
export const TOKEN_EXPIRY_DAYS = 30;

/** TFA login session validity period (minutes) */
export const TFA_LOGIN_SESSION_EXPIRY_MINUTES = 5;

/** Email verification code validity period (minutes) */
export const EMAIL_VERIFICATION_CODE_EXPIRY_MINUTES = 5;

/** Passkey session validity period (minutes) */
export const PASSKEY_SESSION_EXPIRY_MINUTES = 5;

/** Default JWT secret (development only; must be overridden via JWT_SECRET in production) */
export const JWT_DEFAULT_SECRET =
  'rustdesk-api-secret-key-change-in-production';

/**
 * Login type enum
 * Corresponds to the LoginDto.type field and identifies the login flow requested by the client
 */
export enum LoginType {
  /** Standard username/password login */
  ACCOUNT = 'account',
  /** Phone number login */
  MOBILE = 'mobile',
  /** SMS code login */
  SMS_CODE = 'sms_code',
  /** Email verification code login (second step) */
  EMAIL_CODE = 'email_code',
  /** TFA code login (second step) */
  TFA_CODE = 'tfa_code',
  /** Passkey two-factor authentication check */
  PASSKEY_CHECK = 'passkey_check',
}

/** List of allowed LoginDto.type values, used by class-validator @IsIn */
export const LOGIN_TYPE_VALUES: string[] = Object.values(LoginType);
