import { Controller, Post, Body, Header } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SysinfoService } from './sysinfo.service';
import { SysinfoDto } from './dto/sysinfo.dto';
import { Public } from '../auth/decorators/public.decorator';

/**
 * System info controller
 * Handles reporting and querying of device system information
 *
 * Number of endpoints: 1
 * - POST /api/sysinfo - Submit system info
 */
@Controller()
export class SysinfoController {
  constructor(private readonly sysinfoService: SysinfoService) {}

  /**
   * Submit system info
   * Receives system info reported by devices and creates/updates it in the database
   *
   * Description:
   * - Check whether the device is registered in the peers table; returns ID_NOT_FOUND if not
   * - For registered devices, create or update the system info in the sysinfos table (operating system, hardware configuration, etc.)
   * - Supports automatic assignment of preset address books and device groups
   *
   * Security measures:
   * - Uses the @Public decorator, accessible without authentication (devices use their own token)
   * - Rate limiting enabled: at most 5 requests per minute
   *
   * @param sysinfoDto system info data transfer object containing device ID, token, and detailed system information
   * @returns returns SYSINFO_UPDATED on success, or ID_NOT_FOUND if the device is not registered in the peers table
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('sysinfo')
  @Header('Content-Type', 'text/plain')
  async submitSysInfo(@Body() sysinfoDto: SysinfoDto): Promise<string> {
    const result = await this.sysinfoService.createSysinfo(sysinfoDto);
    return result.found ? 'SYSINFO_UPDATED' : 'ID_NOT_FOUND';
  }
}
