import {
  IsString,
  IsOptional,
  IsBoolean,
  IsUrl,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 设备信息
 */
export class DeviceInfoDto {
  @IsString()
  os: string; // 操作系统：Linux, Windows, Android...

  @IsString()
  type: string; // 类型：browser 或 client

  @IsString()
  name: string; // 设备名称或浏览器信息
}

/**
 * OIDC 授权请求
 */
export class OidcAuthRequestDto {
  @IsString()
  op: string; // OIDC 提供商标识，如 oidc/google

  @IsOptional()
  @IsString()
  id?: string; // 设备ID（客户端特有字段）

  @IsOptional()
  @IsString()
  uuid?: string; // 设备UUID（客户端特有字段）

  @ValidateNested()
  @Type(() => DeviceInfoDto)
  deviceInfo: DeviceInfoDto; // 设备信息（必填）

  @IsOptional()
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
  })
  callbackUrl?: string; // Web前端回调URL（可选）

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean; // 是否记住登录（可选，Web前端登录时使用）
}
