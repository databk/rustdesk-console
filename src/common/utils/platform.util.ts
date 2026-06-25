/**
 * Map database os field to standardized platform constant.
 *
 * Database `os` field format: `{distribution_id} / {long_os_version}`
 * Examples:
 *   - "windows / Windows 10 Pro - 10 (19045)"
 *   - "linux / Ubuntu 22.04"
 *   - "macos / macOS 14.0"
 *   - "android / Android 14"
 *
 * The `platform` field in API responses must be one of:
 *   "Windows" | "Linux" | "Mac OS" | "Android"
 */
export function mapOsToPlatform(os: string | null | undefined): string {
  if (!os) return '';

  // Extract distribution_id (part before " / ")
  const distributionId = os.includes(' / ')
    ? os.split(' / ')[0].toLowerCase().trim()
    : os.toLowerCase().trim();

  if (distributionId.includes('windows') || distributionId === 'win') {
    return 'Windows';
  }
  if (
    distributionId.includes('mac') ||
    distributionId.includes('darwin') ||
    distributionId === 'macos' ||
    distributionId === 'osx'
  ) {
    return 'Mac OS';
  }
  if (distributionId.includes('android')) {
    return 'Android';
  }
  if (distributionId.includes('linux')) {
    return 'Linux';
  }

  // Fallback: try matching against the full os string
  const osLower = os.toLowerCase();
  if (osLower.includes('windows')) return 'Windows';
  if (osLower.includes('mac') || osLower.includes('darwin')) return 'Mac OS';
  if (osLower.includes('android')) return 'Android';
  if (osLower.includes('linux')) return 'Linux';

  return '';
}
