import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

/**
 * SysinfoDto
 * 用于设备系统信息上报
 */
export class SysinfoDto {
  @IsString()
  @IsNotEmpty()
  uuid: string;

  @IsString()
  @IsOptional()
  hostname?: string;

  @IsString()
  @IsOptional()
  username?: string;

  @IsString()
  @IsOptional()
  os?: string;

  @IsString()
  @IsOptional()
  cpu?: string;

  @IsString()
  @IsOptional()
  memory?: string;

  @IsString()
  @IsOptional()
  version?: string;

  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsOptional()
  'preset-address-book-name'?: string;

  @IsString()
  @IsOptional()
  'preset-address-book-tag'?: string;

  @IsString()
  @IsOptional()
  'preset-address-book-alias'?: string;

  @IsString()
  @IsOptional()
  'preset-address-book-password'?: string;

  @IsString()
  @IsOptional()
  'preset-address-book-note'?: string;

  @IsString()
  @IsOptional()
  'preset-username'?: string;

  @IsString()
  @IsOptional()
  'preset-strategy-name'?: string;

  @IsString()
  @IsOptional()
  'preset-device-group-name'?: string;

  @IsString()
  @IsOptional()
  'preset-note'?: string;
}
