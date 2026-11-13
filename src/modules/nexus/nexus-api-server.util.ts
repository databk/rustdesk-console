import type { NexusCustomDto } from './dto/nexus-client.dto';

const API_SERVER_KEY = 'api-server';

function parseHttpOrigin(raw: string): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function hasNonEmptyValue(
  settings: Record<string, unknown> | undefined,
): boolean {
  const value = settings?.[API_SERVER_KEY];
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== undefined && value !== null;
}

/**
 * Embeds the console origin as the client's default API server when the build
 * request does not already specify one.
 *
 * The official client derives `http://<id-server>:21114` when `api-server` is
 * empty, which breaks as soon as the console is only reachable over HTTPS.
 * Seeding `default-settings` keeps the value editable in the client, while an
 * explicit `override-settings` or `default-settings` value always wins.
 */
export function withDefaultApiServer(
  custom: NexusCustomDto,
  frontendUrl: string,
): NexusCustomDto {
  const origin = parseHttpOrigin(frontendUrl);
  if (!origin) return custom;

  const overrideSettings = custom['override-settings'];
  const defaultSettings = custom['default-settings'];
  if (hasNonEmptyValue(overrideSettings) || hasNonEmptyValue(defaultSettings)) {
    return custom;
  }

  return {
    ...custom,
    'default-settings': {
      ...(defaultSettings ?? {}),
      [API_SERVER_KEY]: origin,
    },
  };
}
