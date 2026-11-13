import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { HeartbeatService } from './heartbeat.service';
import { HeartbeatHealthService } from './services/heartbeat-health.service';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { Public } from '../auth/decorators/public.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';

function firstHeader(value: string | string[] | undefined): string | undefined {
  return (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim();
}

/**
 * Best-effort public origin of the current request. Behind a reverse proxy this
 * prefers X-Forwarded-Proto / X-Forwarded-Host; otherwise Express derives the
 * origin from the connection. The value is only used as a diagnostic hint.
 */
function requestOrigin(request: Request): string | undefined {
  const forwardedProto = firstHeader(request.headers['x-forwarded-proto']);
  const protocol =
    forwardedProto === 'https' || forwardedProto === 'http'
      ? forwardedProto
      : request.protocol;
  const host =
    firstHeader(request.headers['x-forwarded-host']) ??
    firstHeader(request.headers.host);
  if (!host) return undefined;
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return undefined;
  }
}

/**
 * Heartbeat controller
 * Handles device heartbeat requests and maintains device online status
 *
 * Number of endpoints: 2
 * - POST /api/heartbeat - Receive device heartbeat
 * - GET /api/heartbeat/health - Heartbeat delivery diagnostics (admin only)
 */
@Controller('heartbeat')
export class HeartbeatController {
  constructor(
    private readonly HeartbeatService: HeartbeatService,
    private readonly heartbeatHealthService: HeartbeatHealthService,
  ) {}

  /**
   * Receive device heartbeat
   * Processes heartbeat data sent by devices, updating the device online status and last active time
   *
   * Description:
   * - Validate device identity and token validity
   * - Update the device online status
   * - Record the device last active time
   * - Update device information (e.g. IP address, operating system)
   *
   * Security measures:
   * - Uses the @Public decorator, accessible without authentication (devices use their own token)
   * - Rate limiting enabled: at most 10 requests per minute
   *
   * @param HeartbeatDto heartbeat data transfer object containing device ID, token, and status information
   * @returns Returns a confirmation message on success
   * @throws UnauthorizedException device token is invalid or expired
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post()
  receiveHeartbeat(@Body() HeartbeatDto: HeartbeatDto) {
    return this.HeartbeatService.handleHeartbeat(HeartbeatDto);
  }

  /**
   * Report whether heartbeats are still reaching the console.
   *
   * This endpoint never changes device online state. It exists so the console
   * can explain an all-devices-offline situation, most commonly caused by
   * clients still using the legacy `http://<id-server>:21114` API address
   * behind an HTTPS-only reverse proxy.
   */
  @Get('health')
  @UseGuards(AdminGuard)
  getHealth(@Req() request: Request) {
    return this.heartbeatHealthService.getHealth(requestOrigin(request));
  }
}
