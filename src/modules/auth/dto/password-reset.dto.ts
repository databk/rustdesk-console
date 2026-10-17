import { IsString, MinLength } from 'class-validator';

/**
 * RequestPasswordResetDto
 * Used to request a password reset link; the account is identified by username or email
 */
export class RequestPasswordResetDto {
  @IsString()
  @MinLength(1)
  username_or_email: string;
}

/**
 * ValidateResetTokenDto
 * Used to check whether a password reset token is still valid
 */
export class ValidateResetTokenDto {
  @IsString()
  @MinLength(1)
  token: string;
}

/**
 * ConfirmPasswordResetDto
 * Used to set a new password with a valid reset token
 */
export class ConfirmPasswordResetDto {
  @IsString()
  @MinLength(1)
  token: string;

  @IsString()
  @MinLength(6)
  new_password: string;
}
