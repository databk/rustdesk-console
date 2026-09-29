import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const PAGINATION_DEFAULT_CURRENT = 1;
export const PAGINATION_DEFAULT_PAGE_SIZE = 20;
export const PAGINATION_MAX_CURRENT = 100000;
export const PAGINATION_MAX_PAGE_SIZE = 100;

/**
 * 分页查询基类
 * 统一 current / pageSize 的定义、默认值与约束，供所有列表查询 DTO 继承。
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINATION_MAX_CURRENT)
  current?: number = PAGINATION_DEFAULT_CURRENT;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINATION_MAX_PAGE_SIZE)
  pageSize?: number = PAGINATION_DEFAULT_PAGE_SIZE;
}

/**
 * 分页响应统一形状
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
}
