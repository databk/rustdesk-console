import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { SetupService, SetupStatus, SetupCompletionResult } from './setup.service';
import { CompleteSetupDto } from './dto/complete-setup.dto';

/**
 * SetupController
 * Public endpoints consumed by the setup wizard UI that runs before the
 * admin account has ever been configured. No JWT guard required.
 *
 * Throttling: POST is heavily restricted because it writes to DB + hits
 * external services (hbbs /v1/status). GET allows more calls — the wizard
 * polls it.
 */
@Controller('settings/setup')
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  /**
   * Return whether setup has been completed. The frontend setup page polls
   * this and redirects to login once completed=true.
   */
  @Public()
  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  getStatus(): Promise<SetupStatus> {
    return this.setupService.getStatus();
  }

  /**
   * Complete the setup wizard. Accepts the server origin plus optional admin
   * password reset and WebClient public key. Performs a best-effort commit:
   * site URL is the commit point; every pre-check must pass before writes.
   *
   * Rate limit: 5 POSTs per minute. Setup is exactly-once, so 5 is plenty
   * for retries if the user mistypes something — beyond that we suspect
   * brute-force or automated abuse.
   */
  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  complete(@Body() dto: CompleteSetupDto): Promise<SetupCompletionResult> {
    return this.setupService.complete(dto);
  }
}
