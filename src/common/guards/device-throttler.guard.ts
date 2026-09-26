import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Device throttler guard
 *
 * Throttles by device ID instead of IP address
 * Suitable for endpoints such as heartbeat and system info that need per-device throttling
 */
@Injectable()
export class DeviceThrottlerGuard extends ThrottlerGuard {
  /**
   * Overrides getTracker to extract the device ID from the request body
   *
   * Priority:
   * 1. req.body.id (heartbeat endpoint)
   * 2. req.body.uuid (system info endpoint)
   * 3. req.body.deviceId (generic)
   * 4. fall back to the IP address
   *
   * Return format: {deviceID}:{HTTP method}:{route path}
   */
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    // 1. Try to extract the device ID from the request body
    const body = req.body as Record<string, unknown> | undefined;
    const rawDeviceId = body?.id || body?.uuid || body?.deviceId;
    const deviceId =
      typeof rawDeviceId === 'string'
        ? rawDeviceId
        : rawDeviceId != null
          ? String(rawDeviceId)
          : '';

    if (deviceId) {
      // Use the device ID as the tracker
      const route = req.route as { path?: string } | undefined;
      return Promise.resolve(
        `${deviceId}:${String(req.method)}:${route?.path ?? ''}`,
      );
    }

    // 2. If there is no device ID, fall back to the IP address (to prevent malicious requests)
    const connection = req.connection as { remoteAddress?: string } | undefined;
    const rawIp = req.ip || connection?.remoteAddress || 'unknown';
    const ip =
      typeof rawIp === 'string'
        ? rawIp
        : rawIp != null
          ? String(rawIp)
          : 'unknown';
    const route = req.route as { path?: string } | undefined;
    return Promise.resolve(`${ip}:${String(req.method)}:${route?.path ?? ''}`);
  }
}
