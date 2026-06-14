import {
  IsString,
  IsBoolean,
  IsOptional,
  IsArray,
  IsNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * TLS 配置 DTO
 * 仅允许安全的 TLS 选项，防止注入危险属性如 rejectUnauthorized: false
 */
export class TlsOptionsDto {
  /** CA 证书（PEM 格式字符串或 Buffer） */
  @IsOptional()
  @IsString()
  ca?: string;

  /** 客户端证书（PEM 格式字符串） */
  @IsOptional()
  @IsString()
  cert?: string;

  /** 客户端私钥（PEM 格式字符串） */
  @IsOptional()
  @IsString()
  key?: string;

  /** 服务器名称指示（SNI） */
  @IsOptional()
  @IsString()
  servername?: string;
}

/**
 * 更新 LDAP 配置 DTO
 * 所有字段可选，仅更新传入的字段
 */
export class UpdateLdapConfigDto {
  /** LDAP 服务器 URL 列表（支持多个服务器故障转移），如 ldaps://ad1.example.com:636 */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  urls?: string[];

  /** 服务账号绑定 DN，如 CN=svc-ldap,OU=ServiceAccounts,DC=example,DC=com */
  @IsString()
  @IsOptional()
  bindDN?: string;

  /** 服务账号密码 */
  @IsString()
  @IsOptional()
  bindCredentials?: string;

  /** 搜索基础 DN，如 DC=example,DC=com */
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  searchBase?: string;

  /** 搜索过滤器，如 (sAMAccountName={{username}}) */
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  searchFilter?: string;

  /** 要读取的用户属性列表 */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  searchAttributes?: string[];

  /** 组搜索基础 DN */
  @IsString()
  @IsOptional()
  groupSearchBase?: string;

  /** 组搜索过滤器，如 (member={{dn}}) */
  @IsString()
  @IsOptional()
  groupSearchFilter?: string;

  /** 映射为管理员的 LDAP 组 DN 列表 */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  adminGroups?: string[];

  /** TLS 配置（仅允许 ca/cert/key/servername 安全选项） */
  @ValidateNested()
  @Type(() => TlsOptionsDto)
  @IsOptional()
  tlsOptions?: TlsOptionsDto;

  /** 是否启用 LDAP 认证 */
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

/**
 * 测试 LDAP 连接 DTO
 * 可选传入配置进行测试，不传则测试当前生效配置
 */
export class TestLdapConfigDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  urls?: string[];

  @IsString()
  @IsOptional()
  bindDN?: string;

  @IsString()
  @IsOptional()
  bindCredentials?: string;

  @IsString()
  @IsOptional()
  searchBase?: string;

  @IsString()
  @IsOptional()
  searchFilter?: string;
}
