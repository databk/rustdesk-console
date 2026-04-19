import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * 设备限流守卫
 *
 * 基于设备ID进行限流，而不是基于IP地址
 * 适用于心跳和系统信息等需要按设备独立限流的端点
 */
@Injectable()
export class DeviceThrottlerGuard extends ThrottlerGuard {
  /**
   * 重写 getTracker 方法，从请求体提取设备ID
   *
   * 优先级：
   * 1. req.body.id (心跳端点)
   * 2. req.body.uuid (系统信息端点)
   * 3. req.body.deviceId (通用)
   * 4. 降级使用IP地址
   *
   * 返回格式：{设备ID}:{HTTP方法}:{路由路径}
   */
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    // 1. 尝试从请求体提取设备ID
    const body = req.body as Record<string, unknown> | undefined;
    const rawDeviceId = body?.id || body?.uuid || body?.deviceId;
    const deviceId =
      typeof rawDeviceId === 'string'
        ? rawDeviceId
        : rawDeviceId != null
          ? String(rawDeviceId)
          : '';

    if (deviceId) {
      // 使用设备ID作为tracker
      const route = req.route as { path?: string } | undefined;
      return Promise.resolve(
        `${deviceId}:${String(req.method)}:${route?.path ?? ''}`,
      );
    }

    // 2. 如果没有设备ID，降级使用IP地址（防止恶意请求）
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
