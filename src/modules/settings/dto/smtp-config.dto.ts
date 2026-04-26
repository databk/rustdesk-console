import {
  IsString,
  IsNumber,
  IsBoolean,
  IsNotEmpty,
  Min,
  Max,
  IsOptional,
} from 'class-validator';

/**
 * 创建 SMTP 配置 DTO
 */
export class CreateSmtpConfigDto {
  @IsString()
  @IsNotEmpty()
  host: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  port: number;

  @IsBoolean()
  @IsOptional()
  secure?: boolean;

  @IsString()
  @IsNotEmpty()
  user: string;

  @IsString()
  @IsNotEmpty()
  pass: string;

  @IsString()
  @IsNotEmpty()
  from: string;
}

/**
 * 更新 SMTP 配置 DTO
 * 所有字段可选，仅更新传入的字段
 */
export class UpdateSmtpConfigDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  host?: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  @IsOptional()
  port?: number;

  @IsBoolean()
  @IsOptional()
  secure?: boolean;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  user?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  pass?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  from?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

/**
 * 测试 SMTP 连接 DTO
 * 可选传入配置进行测试，不传则测试当前生效配置
 */
export class TestSmtpConfigDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  host?: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  @IsOptional()
  port?: number;

  @IsBoolean()
  @IsOptional()
  secure?: boolean;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  user?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  pass?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  from?: string;
}
