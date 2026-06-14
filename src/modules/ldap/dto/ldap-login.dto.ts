import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

/**
 * LDAP 登录 DTO
 * 通过 LDAP 进行身份验证的请求参数
 */
export class LdapLoginDto {
  /** LDAP 用户名 */
  @IsString()
  @IsNotEmpty()
  username: string;

  /** LDAP 密码 */
  @IsString()
  @IsNotEmpty()
  password: string;

  /** 设备 ID */
  @IsString()
  @IsOptional()
  id?: string;

  /** 设备 UUID */
  @IsString()
  @IsOptional()
  uuid?: string;

  /** 设备信息 */
  @IsOptional()
  deviceInfo?: Record<string, any>;
}
