import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { AuthService } from '../services/auth.service';
import { JwtPayload } from '../../../common/services/token.service';
import { JWT_DEFAULT_SECRET } from '../auth.constants';

/**
 * Extract the JWT token from the request
 * Supports two authentication methods:
 * 1. Authorization header Bearer token (used by the client app)
 * 2. Cookie access_token (used by the web frontend)
 *
 * @param req Express request object
 * @returns JWT token string or null
 */
function extractToken(req: Request): string | null {
  // Prefer extracting the Bearer token from the Authorization header
  const authHeaderToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  if (authHeaderToken) {
    return authHeaderToken;
  }

  // If not in the header, extract it from the Cookie
  if (req.cookies && 'access_token' in req.cookies) {
    const token = req.cookies.access_token as string;
    return token;
  }

  return null;
}

/**
 * JWT authentication strategy
 * Uses Passport's JWT strategy for token validation and user authentication
 *
 * Validation logic:
 * 1. Extract the token from the Authorization request header or the Cookie
 * 2. Verify the token signature and expiry using the JWT secret
 * 3. Check whether the token has been revoked
 * 4. Extract the user info and return it
 *
 * Security measures:
 * - Token expiry is not ignored
 * - Supports a token revocation mechanism
 * - JWT secret is configured via environment variable
 * - Supports dual-mode authentication (Header + Cookie)
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(private authService: AuthService) {
    const jwtSecret = process.env.JWT_SECRET || JWT_DEFAULT_SECRET;

    if (!process.env.JWT_SECRET) {
      const logger = new Logger('JwtStrategy');
      logger.warn(
        'WARNING: Using default JWT secret key. Please set JWT_SECRET environment variable in production!',
      );
    }

    super({
      jwtFromRequest: extractToken,
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
      passReqToCallback: true,
    });
  }

  /**
   * Validate the JWT token
   * Validates the token and extracts the user info
   *
   * Validation flow:
   * 1. Extract the token from the request header or Cookie
   * 2. Check that the token exists
   * 3. Check whether the token has been revoked
   * 4. Extract the user info (ID, username, email, admin flag)
   *
   * @param req Express request object, used to access request headers and Cookies
   * @param payload JWT payload containing basic user info
   * @returns The validated user info
   * @throws UnauthorizedException the token is invalid, expired, or revoked
   */
  async validate(
    req: Request,
    _payload: JwtPayload,
  ): Promise<Record<string, unknown>> {
    const token = extractToken(req);

    // Reject immediately if the token is missing
    if (!token) {
      throw new UnauthorizedException('Invalid token');
    }

    // Check whether the token has been revoked
    const validPayload = await this.authService.validateToken(token);
    if (!validPayload) {
      throw new UnauthorizedException('Token expired or revoked');
    }

    const { sub, username, email, isAdmin, jti } = validPayload;

    // Keep the original field name id; the actual value is the user's guid
    return {
      id: sub, // Keep the original field name id; the value is the user's guid
      username,
      email,
      isAdmin,
      jti, // Unique token identifier, used for session management
    };
  }
}
