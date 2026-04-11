import { IsString, IsObject } from 'class-validator';

/**
 * 设备信息
 */
export class DeviceInfoDto {
  @IsString()
  os: string;    // 操作系统：Linux, Windows, Android...

  @IsString()
  type: string;  // 类型：browser 或 client

  @IsString()
  name: string;  // 设备名称或浏览器信息
}

/**
 * OIDC 授权请求
 */
export class OidcAuthRequestDto {
  @IsString()
  op: string;  // OIDC 提供商标识，如 oidc/google

  @IsString()
  id: string;  // 设备ID

  @IsString()
  uuid: string;  // 设备UUID

  @IsObject()
  deviceInfo: DeviceInfoDto;  // 设备信息
}
