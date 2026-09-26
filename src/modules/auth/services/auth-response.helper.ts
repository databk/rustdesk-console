import { Injectable } from '@nestjs/common';
import { User } from '../../user/entities/user.entity';
import { LoginResponse } from '../../../common/interfaces';

/** User payload type in the login response (optionality removed to guarantee complete fields) */
export type UserPayload = NonNullable<LoginResponse['user']>;

/**
 * Auth response builder helper
 * Builds the user info payload in login responses in one place, eliminating duplicated implementations
 */
@Injectable()
export class AuthResponseHelper {
  /**
   * builds the user info payload in the login response
   * Used by all login flows: login / TFA / email verification code / Passkey, etc.
   */
  buildUserPayload(user: User): UserPayload {
    return {
      guid: user.guid,
      name: user.username,
      display_name: user.displayName || undefined,
      email: user.email || undefined,
      note: user.note || undefined,
      status: user.status,
      info: user.getUserInfo(),
      is_admin: user.isAdmin,
      third_auth_type: user.thirdAuthType || undefined,
      ...(user.avatar ? { avatar: user.avatar } : {}),
    };
  }

  /**
   * Build the response payload for the currentUser endpoint
   * Extends buildUserPayload with an additional verifier field
   */
  buildCurrentUserPayload(user: User): Record<string, unknown> {
    return {
      ...this.buildUserPayload(user),
      verifier: user.verifier || undefined,
    };
  }
}
