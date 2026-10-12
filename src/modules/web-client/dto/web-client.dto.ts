import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { BadRequestException } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';

// 空 DTO 没有校验元数据，不能依赖 whitelist 自动拒绝额外字段。
export class WebClientEmptyBodyPipe implements PipeTransform {
  transform(value: unknown): undefined | Record<string, never> {
    if (value === undefined) return undefined;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length
    )
      throw new BadRequestException('Request body must be empty');
    return value as Record<string, never>;
  }
}

export class WebClientSessionDto {
  @IsString()
  @MaxLength(256)
  targetId: string;
}

export class WebClientDevicesDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  id?: string;

  @IsOptional()
  @IsIn(['0', '1'])
  is_online?: string;
}

export const WEB_CLIENT_BROWSER_EVENTS = [
  'remote_auth_succeeded',
  'remote_auth_failed',
  'file_started',
  'file_completed',
  'file_failed',
] as const;
export class WebClientEventDto {
  @IsIn(WEB_CLIENT_BROWSER_EVENTS)
  event: (typeof WEB_CLIENT_BROWSER_EVENTS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  // File names from the browser must not contain path separators or control characters.
  // eslint-disable-next-line no-control-regex
  @Matches(/^[^/\\\x00-\x1f\x7f]+$/u)
  fileName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(16 * 1024 * 1024 * 1024)
  size?: number;

  @IsOptional()
  @IsIn(['upload', 'download'])
  direction?: 'upload' | 'download';
}
