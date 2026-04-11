import { IsString, IsOptional, IsNotEmpty, IsArray, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * 添加设备到地址簿的数据传输对象
 */
export class AddPeerDto {
  /**
   * 设备ID
   * RustDesk客户端的唯一标识，通常为数字格式
   * 用于关联 sysinfos 表获取设备详细信息（如用户名、主机名、操作系统等）
   */
  @IsString()
  @IsNotEmpty()
  id: string;

  /**
   * 连接哈希值
   * 用于验证连接的安全哈希值（个人地址簿使用）
   */
  @IsOptional()
  @IsString()
  hash?: string;

  /**
   * 连接密码
   * 设备的连接密码（共享地址簿使用）
   */
  @IsOptional()
  @IsString()
  password?: string;

  /**
   * 设备别名
   * 用户自定义的设备显示名称
   */
  @IsOptional()
  @IsString()
  alias?: string;

  /**
   * 备注信息
   * 设备的详细说明或备注
   */
  @IsOptional()
  @IsString()
  note?: string;

  /**
   * 标签名称列表
   * 设备关联的标签名称数组
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  // 以下字段为客户端发送的额外字段，暂不处理

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  hostname?: string;

  @IsOptional()
  @IsString()
  platform?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  forceAlwaysRelay?: boolean;

  @IsOptional()
  @IsString()
  rdpPort?: string;

  @IsOptional()
  @IsString()
  rdpUsername?: string;

  @IsOptional()
  @IsString()
  loginName?: string;

  @IsOptional()
  @IsString()
  device_group_name?: string;

  @IsOptional()
  @IsBoolean()
  same_server?: boolean;
}

/**
 * 更新设备信息的数据传输对象
 */
export class UpdatePeerDto {
  /**
   * 设备ID
   * RustDesk客户端的唯一标识
   */
  @IsString()
  @IsNotEmpty()
  id: string;

  /**
   * 连接哈希值
   * 用于验证连接的安全哈希值（个人地址簿使用）
   */
  @IsOptional()
  @IsString()
  hash?: string;

  /**
   * 连接密码
   * 设备的连接密码（共享地址簿使用）
   */
  @IsOptional()
  @IsString()
  password?: string;

  /**
   * 设备别名
   * 用户自定义的设备显示名称
   */
  @IsOptional()
  @IsString()
  alias?: string;

  /**
   * 备注信息
   * 设备的详细说明或备注
   */
  @IsOptional()
  @IsString()
  note?: string;

  /**
   * 标签名称列表
   * 设备关联的标签名称数组
   * 更新时会替换原有的标签关联关系
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /**
   * 设备登录用户名
   * 用于同步设备信息
   */
  @IsOptional()
  @IsString()
  username?: string;

  /**
   * 设备主机名
   * 用于同步设备信息
   */
  @IsOptional()
  @IsString()
  hostname?: string;

  /**
   * 操作系统
   * 用于同步设备信息
   */
  @IsOptional()
  @IsString()
  platform?: string;
}
