import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';

/**
 * 设备限流守卫
 *
 * 基于设备ID进行限流，而不是基于IP地址
 * 适用于心跳和系统信息等需要按设备独立限流的端点
 */
@Injectable()
export class DeviceThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(DeviceThrottlerGuard.name);

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
    this.logger.debug(`[getTracker] 开始提取tracker, method=${String(req.method)}, url=${String(req.url ?? '')}`);

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
      const tracker = `${deviceId}:${String(req.method)}:${route?.path ?? ''}`;
      this.logger.debug(`[getTracker] 使用设备ID作为tracker: ${tracker}`);
      return Promise.resolve(tracker);
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
    const tracker = `${ip}:${String(req.method)}:${route?.path ?? ''}`;
    this.logger.warn(`[getTracker] 未找到设备ID，降级使用IP作为tracker: ${tracker}`);
    return Promise.resolve(tracker);
  }

  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, limit, ttl } = requestProps;
    const req = context.switchToHttp().getRequest<Record<string, unknown>>();
    const body = req.body as Record<string, unknown> | undefined;
    const deviceId = body?.id || body?.uuid || body?.deviceId || 'unknown';
    const route = req.route as { path?: string } | undefined;
    const path = route?.path ?? String(req.url ?? '');
    const method = String(req.method);

    this.logger.debug(
      `[handleRequest] 限流检查开始: device=${deviceId}, method=${method}, path=${path}, limit=${limit}, ttl=${ttl}ms`,
    );

    try {
      const result = await super.handleRequest(requestProps);

      if (result) {
        this.logger.log(
          `[handleRequest] 限流通过: device=${deviceId}, method=${method}, path=${path}, limit=${limit}, ttl=${ttl}ms`,
        );
      } else {
        this.logger.warn(
          `[handleRequest] 限流拒绝: device=${deviceId}, method=${method}, path=${path}, limit=${limit}, ttl=${ttl}ms`,
        );
      }

      return result;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[handleRequest] 限流检查异常: device=${deviceId}, method=${method}, path=${path}, error=${msg}`,
      );
      throw error;
    }
  }
}
