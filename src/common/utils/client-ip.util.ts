import { isIP } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';

/** Longest textual IP address stored in audit records (IPv4-mapped IPv6). */
export const MAX_CLIENT_IP_LENGTH = 45;

/** Minimal request shape needed to resolve the client address. */
export interface ClientAddressSource {
  headers: IncomingHttpHeaders;
  socket?: { remoteAddress?: string };
}

const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/;
const BRACKETED_IPV6 = /^\[([^\]]+)\](?::\d+)?$/;
const IPV4_MAPPED_IPV6 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * Reads the `TRUSTED_PROXY` switch. Only `true` or `1` (case-insensitive)
 * enable it, so forwarded headers are ignored unless explicitly trusted.
 */
export function isTrustedProxyEnabled(
  value: string | undefined = process.env.TRUSTED_PROXY,
): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

/**
 * Normalizes a textual address to a plain IP: strips a port suffix or IPv6
 * brackets and unwraps IPv4-mapped IPv6 addresses. Returns null for anything
 * that is not a valid IP address.
 */
export function normalizeIp(value: string | undefined): string | null {
  let candidate = value?.trim();
  if (!candidate) return null;
  candidate =
    IPV4_WITH_PORT.exec(candidate)?.[1] ??
    BRACKETED_IPV6.exec(candidate)?.[1] ??
    candidate;
  candidate = IPV4_MAPPED_IPV6.exec(candidate)?.[1] ?? candidate;
  if (!isIP(candidate) || candidate.length > MAX_CLIENT_IP_LENGTH) return null;
  return candidate;
}

/**
 * Resolves the client IP of a request.
 *
 * Without a trusted proxy the TCP peer address is used and forwarded headers
 * are ignored, because any client can forge them. With a trusted proxy the
 * right-most `X-Forwarded-For` entry is used: it is the address the proxy in
 * front of the console saw, appended by the proxy itself, while entries to
 * its left come from the client and cannot be trusted. Requests that reach
 * the console without a usable header fall back to the TCP peer address.
 */
export function extractClientIp(
  request: ClientAddressSource,
  trustedProxy: boolean,
): string | null {
  if (trustedProxy) {
    const header = request.headers['x-forwarded-for'];
    const entries = (Array.isArray(header) ? header.join(',') : (header ?? ''))
      .split(',')
      .map((entry) => entry.trim());
    const last = entries[entries.length - 1];
    if (last) {
      const forwarded = normalizeIp(last);
      if (forwarded) return forwarded;
    }
  }
  return normalizeIp(request.socket?.remoteAddress);
}
