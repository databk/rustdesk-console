/**
 * Checks whether the given ID is in IP address format
 * Supported formats:
 * - IPv4: "192.168.1.94"
 * - IPv4 + port: "192.168.1.94:21118"
 * - IPv6: "[::1]" or "[::1]:21118"
 *
 * @param id device ID
 * @returns true if the ID is in IP format, otherwise false
 */
export function isIpDevice(id: string): boolean {
  if (!id || typeof id !== 'string') {
    return false;
  }

  // IPv6 format: [::1] or [::1]:port
  if (id.startsWith('[')) {
    return true;
  }

  // IPv4 format: contains dots, e.g. 192.168.1.94 or 192.168.1.94:21118
  // Match IPv4 or IPv4:port via regex
  const ipv4WithOptionalPort = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/;
  return ipv4WithOptionalPort.test(id);
}
