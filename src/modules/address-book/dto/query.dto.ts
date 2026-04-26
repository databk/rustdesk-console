import {
  IsNumber,
  IsString,
  IsOptional,
  Min,
  IsNotEmpty,
  IsArray,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 分页查询数据传输对象
 * 用于支持列表数据的分页查询
 */
export class PaginationDto {
  /**
   * 当前页码
   * 从1开始计数
   * 默认值: 1
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  current?: number = 1;

  /**
   * 每页数量
   * 控制每页返回的数据条数
   * 默认值: 100
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  pageSize?: number = 100;

  /**
   * 名称过滤
   * 用于按名称筛选地址簿
   */
  @IsOptional()
  @IsString()
  name?: string;
}

/**
 * 标签匹配模式枚举
 */
export enum TagMatchMode {
  /**
   * 并集模式（OR）
   * 匹配任意一个标签即可
   */
  UNION = 'union',
  /**
   * 交集模式（AND）
   * 必须匹配所有标签
   */
  INTERSECTION = 'intersection',
}

/**
 * 设备列表查询数据传输对象
 * 继承分页参数，增加地址簿标识参数
 */
export class PeersQueryDto extends PaginationDto {
  /**
   * 地址簿唯一标识符
   * UUID格式，指定要查询的地址簿
   */
  @IsString()
  @IsNotEmpty()
  ab: string;

  /**
   * 设备ID过滤
   * 用于按设备ID模糊匹配
   */
  @IsOptional()
  @IsString()
  id?: string;

  /**
   * 别名过滤
   * 用于按别名模糊匹配
   */
  @IsOptional()
  @IsString()
  alias?: string;

  /**
   * 标签过滤
   * 用于按标签精确匹配，支持多个标签
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /**
   * 标签匹配模式
   * union: 并集（匹配任意一个标签）
   * intersection: 交集（必须匹配所有标签）
   * 默认值: union
   */
  @IsOptional()
  @IsEnum(TagMatchMode)
  tagMode?: TagMatchMode = TagMatchMode.UNION;
}
