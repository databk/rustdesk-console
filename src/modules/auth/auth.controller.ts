import {
  Controller,
  Post,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './services';
import { AuthTfaService } from './services/auth-tfa.service';
import {
  LoginDto,
  CurrentUserDto,
  LogoutDto,
  VerifyTfaDto,
  DisableTfaDto,
} from './dto/auth.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { Request } from 'express';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tfaService: AuthTfaService,
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
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null;

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

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  async setupTfa(@CurrentUser('id') userId: string) {
    return this.tfaService.setupTfa(userId);
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
}
