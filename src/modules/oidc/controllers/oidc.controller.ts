import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  Res,
  Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { OidcService } from '../services/oidc.service';
import { OidcAuthRequestDto } from '../dto/oidc.dto';
import { Public } from '../../auth/decorators/public.decorator';
import { resolveAssetPath } from '../../../common/utils/runtime-paths';
import { GeneralSettingsService } from '../../settings/services/general-settings.service';

/**
 * Escapes HTML special characters to prevent XSS attacks
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * OIDC controller
 * Handles HTTP requests related to OpenID Connect third-party login
 *
 * Endpoints:
 * - GET /api/login-options - Get login options
 * - POST /api/oidc/auth - Request OIDC authorization
 * - GET /api/oidc/auth-query - Query OIDC authorization state
 * - GET /api/oidc/callback - OIDC provider callback
 */
@Controller()
export class OidcController {
  private readonly logger = new Logger(OidcController.name);
  private readonly successHtml: string;
  private readonly errorHtml: string;

  constructor(
    private readonly oidcService: OidcService,
    private readonly generalSettingsService: GeneralSettingsService,
  ) {
    this.successHtml = fs.readFileSync(
      resolveAssetPath(
        __dirname,
        path.join('..', 'templates', 'callback-success.html'),
        path.join('templates', 'oidc', 'callback-success.html'),
      ),
      'utf-8',
    );
    this.errorHtml = fs.readFileSync(
      resolveAssetPath(
        __dirname,
        path.join('..', 'templates', 'callback-error.html'),
        path.join('templates', 'oidc', 'callback-error.html'),
      ),
      'utf-8',
    );
  }

  /**
   * Get login options
   * Returns the list of currently available OIDC third-party login options
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Get('login-options')
  async getLoginOptions() {
    return this.oidcService.getLoginOptions();
  }

  /**
   * Request OIDC authorization
   * Initiates an OIDC third-party login authorization request and returns the authorization URL
   *
   * @param authRequest OIDC authorization request DTO
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('oidc/auth')
  async requestAuth(@Body() authRequest: OidcAuthRequestDto) {
    return this.oidcService.requestAuth(authRequest);
  }

  /**
   * Query OIDC authorization state
   * The client polls this endpoint to get the authorization result
   *
   * @param code Authorization code
   * @param deviceId device ID
   * @param deviceUuid Device UUID
   */
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Get('oidc/auth-query')
  async queryAuth(
    @Query('code') code: string,
    @Query('id') deviceId: string,
    @Query('uuid') deviceUuid: string,
  ) {
    return this.oidcService.queryAuth(code, deviceId, deviceUuid);
  }

  /**
   * OIDC provider callback endpoint
   * The OIDC provider redirects to this endpoint after authorization completes
   * Exchanges the authorization code for tokens and updates the authorization state
   * - Client login: return the success page
   * - Web frontend login: returns a page containing a script that stores the token according to rememberMe and then redirects
   *
   * @param req Express request object
   * @param res Express response object
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Get('oidc/callback')
  async handleCallback(@Req() req: Request, @Res() res: Response) {
    try {
      // Build the callback URL from the configured backend address to avoid relying on a spoofable Host header
      const { effectiveBackendUrl } =
        await this.generalSettingsService.getSiteSettings();
      const callbackUrl = `${effectiveBackendUrl}${req.originalUrl}`;

      const result = await this.oidcService.handleCallback(callbackUrl);

      if (result.isWebLogin) {
        // Web frontend login: return a page with a script that stores the token and then redirects
        const html = this.successHtml
          .replace('{{title}}', 'Authentication Successful')
          .replace(
            '{{message}}',
            'You have logged in successfully. Redirecting...',
          )
          .replace(/{{token}}/g, escapeHtml(result.accessToken!))
          .replace(/{{callbackUrl}}/g, escapeHtml(result.frontendRedirectUrl!));

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
      } else {
        // Client login: return the success page
        const html = this.successHtml
          .replace('{{title}}', 'Authentication Successful')
          .replace(
            '{{message}}',
            'You have logged in successfully. You can close this window and return to the app.',
          )
          .replace(/{{token}}/g, '')
          .replace(/{{callbackUrl}}/g, '');

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'An error occurred during third-party authentication. Please try again.';
      this.logger.error(`OIDC callback error: ${message}`);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res
        .status(400)
        .send(this.errorHtml.replace('{{message}}', escapeHtml(message)));
    }
  }
}
