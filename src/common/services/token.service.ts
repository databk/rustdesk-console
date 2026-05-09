/**
 * JWT Payload 接口
 */
export interface JwtPayload {
  sub: string;
  username: string;
  email?: string;
  isAdmin: boolean;
  deviceId?: string;
  jti: string;
}
