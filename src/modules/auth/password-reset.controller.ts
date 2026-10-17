import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PasswordResetService } from './services/password-reset.service';
import {
  RequestPasswordResetDto,
  ValidateResetTokenDto,
  ConfirmPasswordResetDto,
} from './dto/password-reset.dto';
import { Public } from './decorators/public.decorator';
import { SkipConsoleAudit } from '../rbac/decorators/skip-console-audit.decorator';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';

@Controller('password-reset')
export class PasswordResetController {
  private readonly logger = new Logger(PasswordResetController.name);

  constructor(
    private readonly passwordResetService: PasswordResetService,
    private readonly auditService: RbacAuditService,
  ) {}

  @Public()
  @SkipConsoleAudit()
  @Throttle({ default: { limit: 3, ttl: 600000 } })
  @Post('request')
  @HttpCode(HttpStatus.OK)
  async requestReset(@Body() dto: RequestPasswordResetDto) {
    return this.passwordResetService.requestReset(dto);
  }

  @Public()
  @SkipConsoleAudit()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  async validateToken(@Body() dto: ValidateResetTokenDto) {
    return this.passwordResetService.validateResetToken(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async confirmReset(@Body() dto: ConfirmPasswordResetDto) {
    let result: Awaited<ReturnType<PasswordResetService['confirmReset']>>;
    try {
      result = await this.passwordResetService.confirmReset(dto);
    } catch (error: unknown) {
      await this.auditService.recordDenied({
        targetType: 'auth',
        action: 'auth.password_reset',
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    try {
      await this.auditService.record({
        targetType: 'auth',
        targetGuid: null,
        action: 'auth.password_reset',
        result: 'allowed',
        afterState: { username: result.username },
      });
    } catch (error: unknown) {
      // The reset has already been committed; an audit-write failure must not
      // turn a successful reset into an error response.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Unable to persist password reset audit: ${message}`);
    }
    return { message: result.message };
  }
}
