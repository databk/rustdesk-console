import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
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

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tfaService: AuthTfaService,
    private readonly passkeyService: AuthPasskeyService,
    private readonly tokenService: AuthTokenService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
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
    return { message: '登出成功' };
  }

  @Post('currentUser')
  @HttpCode(HttpStatus.OK)
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

  // ==================== Passkey 注册 ====================

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

  // ==================== Passkey 无密码登录 ====================

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

  // ==================== Passkey 凭证管理 ====================

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
    return { message: '凭证已删除' };
  }

  // ==================== Passkey 双因素认证 ====================

  @Post('passkey/tfa')
  @HttpCode(HttpStatus.OK)
  async togglePasskeyTfa(
    @CurrentUser('id') userId: string,
    @Body() dto: TogglePasskeyTfaDto,
  ) {
    return this.passkeyService.setPasskeyTfaEnabled(userId, dto.enabled);
  }

  // ==================== 登录会话管理 ====================

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
    return { message: '会话已撤销' };
  }
}
