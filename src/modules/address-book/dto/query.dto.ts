import {
  IsNumber,
  IsString,
  IsOptional,
  Min,
  IsNotEmpty,
  IsArray,
  IsEnum,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * Paginated query data transfer object
 * Used to support paginated queries of list data
 */
export class PaginationDto {
  /**
   * Current page number
   * Counting starts from 1
   * Default value: 1
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  current?: number = 1;

  /**
   * Items per page
   * Controls the number of records returned per page
   * Default value: 100
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  pageSize?: number = 100;

  /**
   * Name filter
   * Used to filter address books by name
   */
  @IsOptional()
  @IsString()
  name?: string;
}

/**
 * Tag match mode enum
 */
export enum TagMatchMode {
  /**
   * Union mode (OR)
   * Matching any one tag is sufficient
   */
  UNION = 'union',
  /**
   * Intersection mode (AND)
   * Must match all tags
   */
  INTERSECTION = 'intersection',
}

/**
 * Device list query data transfer object
 * Inherits pagination parameters and adds the address book identifier parameter
 */
export class PeersQueryDto extends PaginationDto {
  /**
   * Unique address book identifier
   * UUID format, specifies the address book to query
   */
  @IsString()
  @IsNotEmpty()
  ab: string;

  /**
   * Device ID filter
   * Used for fuzzy matching by device ID
   */
  @IsOptional()
  @IsString()
  id?: string;

  /**
   * Alias filter
   * Used for fuzzy matching by alias
   */
  @IsOptional()
  @IsString()
  alias?: string;

  /**
   * Tag filter
   * Used for exact matching by tag, supports multiple tags
   * Supports a single tag or multiple tags (repeated parameter name)
   */
  @IsOptional()
  @Transform(({ value }: { value: string | string[] }) => {
    if (!value) return undefined;
    return Array.isArray(value) ? value : [value];
  })
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /**
   * Tag match mode
   * union: union (matches any one tag)
   * intersection: intersection (must match all tags)
   * Default value: union
   */
  @IsOptional()
  @IsEnum(TagMatchMode)
  tagMode?: TagMatchMode = TagMatchMode.UNION;
}
