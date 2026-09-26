import { Controller, Post, Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { HeartbeatService } from './heartbeat.service';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Heartbeat controller
 * Handles device heartbeat requests and maintains device online status
 *
 * Number of endpoints: 1
 * - POST /api/heartbeat - Receive device heartbeat
 */
@Controller('heartbeat')
export class HeartbeatController {
  constructor(private readonly HeartbeatService: HeartbeatService) {}

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
}
