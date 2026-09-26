import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './services';
import { AuthTfaService } from './services/auth-tfa.service';
import { AuthPasskeyService } from './services/auth-passkey.service';
import { AuthTokenService } from './services/auth-token.service';
import {
  LoginDto,
  CurrentUserDto,
  LogoutDto,
  SetupTfaDto,
  VerifyTfaDto,
  DisableTfaDto,
} from './dto/auth.dto';
import {
  VerifyPasskeyRegistrationDto,
  VerifyPasskeyAuthDto,
  TogglePasskeyTfaDto,
} from './dto/passkey.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { extractBearerToken } from './auth.utils';
import type { Request } from 'express';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';
import { SkipConsoleAudit } from '../rbac/decorators/skip-console-audit.decorator';

@Controller()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly tfaService: AuthTfaService,
    private readonly passkeyService: AuthPasskeyService,
    private readonly tokenService: AuthTokenService,
    private readonly auditService: RbacAuditService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    let response: Awaited<ReturnType<AuthService['login']>>;
    try {
      response = await this.authService.login(loginDto);
    } catch (error: unknown) {
      await this.auditService.recordDenied({
        targetType: 'auth',
        action: 'auth.login',
        reason: error instanceof Error ? error.message : String(error),
        afterState: { username: loginDto.username, login_type: loginDto.type },
      });
      throw error;
    }
    try {
      await this.auditService.record({
        actorUserGuid: response.user?.guid ?? null,
        targetType: 'auth',
        targetGuid: response.user?.guid ?? null,
        action: 'auth.login',
        result: 'allowed',
        afterState: { username: loginDto.username, login_type: loginDto.type },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Unable to persist login audit: ${message}`);
    }
    return response;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser('id') userId: string,
    @Body() logoutDto: LogoutDto,
    @Req() req: Request,
  ) {
    const token = extractBearerToken(req);

    await this.authService.logout(userId, logoutDto, token);
    return { message: 'Logged out successfully' };
  }

  @Post('currentUser')
  @HttpCode(HttpStatus.OK)
  @SkipConsoleAudit()
  async getCurrentUser(
    @CurrentUser('id') userId: string,
    @Body() currentUserDto: CurrentUserDto,
  ): Promise<Record<string, unknown>> {
    return this.authService.getCurrentUser(userId, currentUserDto);
  }

  // ==================== TOTP 2FA ====================

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  async setupTfa(@CurrentUser('id') userId: string, @Body() dto: SetupTfaDto) {
    return this.tfaService.setupTfa(userId, dto.current_code);
  }

  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  async verifyAndBindTfa(
    @CurrentUser('id') userId: string,
    @Body() dto: VerifyTfaDto,
  ) {
    return this.tfaService.verifyAndBindTfa(userId, dto.code);
  }

  @Delete('2fa')
  @HttpCode(HttpStatus.OK)
  async disableTfa(
    @CurrentUser('id') userId: string,
    @Body() dto: DisableTfaDto,
  ) {
    return this.tfaService.disableTfa(userId, dto.code);
  }

  // ==================== Passkey registration ====================

  @Post('passkey/register/begin')
  @HttpCode(HttpStatus.OK)
  async beginPasskeyRegistration(@CurrentUser('id') userId: string) {
    return this.passkeyService.beginRegistration(userId);
  }

  @Post('passkey/register/verify')
  @HttpCode(HttpStatus.OK)
  async verifyPasskeyRegistration(
    @CurrentUser('id') userId: string,
    @Body() dto: VerifyPasskeyRegistrationDto,
  ) {
    return this.passkeyService.verifyRegistration(
      userId,
      dto.response,
      dto.name,
    );
  }

  // ==================== Passkey passwordless login ====================

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('passkey/auth/begin')
  @HttpCode(HttpStatus.OK)
  async beginPasskeyAuth() {
    return this.passkeyService.beginAuthLogin();
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('passkey/auth/verify')
  @HttpCode(HttpStatus.OK)
  async verifyPasskeyAuth(@Body() dto: VerifyPasskeyAuthDto) {
    return this.passkeyService.verifyAuthLogin(
      dto.secret,
      dto.response,
      dto.id,
      dto.uuid,
      dto.deviceInfo,
    );
  }

  // ==================== Passkey credential management ====================

  @Get('passkey/list')
  async listPasskeys(@CurrentUser('id') userId: string) {
    return this.passkeyService.listCredentials(userId);
  }

  @Delete('passkey/:guid')
  @HttpCode(HttpStatus.OK)
  async deletePasskey(
    @CurrentUser('id') userId: string,
    @Param('guid') guid: string,
  ) {
    await this.passkeyService.deleteCredential(userId, guid);
    return { message: 'Credential deleted' };
  }

  // ==================== Passkey two-factor authentication ====================

  @Post('passkey/tfa')
  @HttpCode(HttpStatus.OK)
  async togglePasskeyTfa(
    @CurrentUser('id') userId: string,
    @Body() dto: TogglePasskeyTfaDto,
  ) {
    return this.passkeyService.setPasskeyTfaEnabled(userId, dto.enabled);
  }

  // ==================== Login session management ====================

  @Get('sessions')
  async listSessions(@CurrentUser('id') userId: string) {
    const sessions = await this.tokenService.listSessions(userId);
    return sessions;
  }

  @Delete('sessions/:jti')
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @CurrentUser('id') userId: string,
    @Param('jti') jti: string,
  ) {
    await this.tokenService.revokeSession(userId, jti);
    return { message: 'Session revoked' };
  }
}
