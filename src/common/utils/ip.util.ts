/**
 * 检测给定的ID是否为IP地址格式
 * 支持以下格式：
 * - IPv4: "192.168.1.94"
 * - IPv4 + 端口: "192.168.1.94:21118"
 * - IPv6: "[::1]" 或 "[::1]:21118"
 *
 * @param id 设备ID
 * @returns 如果是IP格式返回true，否则返回false
 */
export function isIpDevice(id: string): boolean {
  if (!id || typeof id !== 'string') {
    return false;
  }

  // IPv6 格式: [::1] 或 [::1]:port
  if (id.startsWith('[')) {
    return true;
  }

  // IPv4 格式: 包含点号，如 192.168.1.94 或 192.168.1.94:21118
  // 通过正则匹配 IPv4 或 IPv4:port
  const ipv4WithOptionalPort = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/;
  return ipv4WithOptionalPort.test(id);
}
