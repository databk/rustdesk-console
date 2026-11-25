/**
 * Device UUID normalisation.
 *
 * RustDesk clients report the UUID as standard base64: desktop clients encode
 * the UUID text, while mobile clients encode the 16 raw UUID bytes. hbbs uses
 * the same base64 text. Storing that text as the Console device identifier is
 * unsafe because standard base64 contains `/`, which cannot appear unescaped
 * in an API path segment (for example `PATCH /api/devices/:guid`).
 *
 * The Console therefore stores and exposes the canonical UUID text:
 * - base64 of a UUID string -> that UUID (lowercase)
 * - base64 of 16 raw bytes  -> 8-4-4-4-12 hexadecimal UUID
 * - 32 hexadecimal digits   -> 8-4-4-4-12 hexadecimal UUID
 *
 * Values that are not one of the supported encodings (including the Console's
 * own 64-character clone-isolation keys) are returned unchanged so legacy rows
 * keep working.
 */

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPACT_UUID = /^[0-9a-f]{32}$/i;
const STANDARD_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Convert a client, hbbs or legacy Console UUID to the canonical form. */
export function normalizeDeviceUuid(value: string): string {
  if (!value) return value;
  if (CANONICAL_UUID.test(value)) return value.toLowerCase();
  if (COMPACT_UUID.test(value)) return formatUuid(Buffer.from(value, 'hex'));

  if (value.length % 4 !== 0 || !STANDARD_BASE64.test(value)) return value;

  const bytes = Buffer.from(value, 'base64');
  // Buffer.from is lenient. Requiring an exact round-trip keeps malformed
  // input from being treated as base64 by accident.
  if (bytes.toString('base64') !== value) return value;

  if (bytes.length === 16) return formatUuid(bytes);

  const decoded = bytes.toString('utf8');
  if (CANONICAL_UUID.test(decoded)) return decoded.toLowerCase();
  if (COMPACT_UUID.test(decoded))
    return formatUuid(Buffer.from(decoded, 'hex'));

  return value;
}
