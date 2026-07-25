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
  /** 角色 code 列表（登录时写入，鉴权快照） */
  roles?: string[];
  /** 权限码列表（登录时写入，鉴权快照） */
  permissions?: string[];
}
