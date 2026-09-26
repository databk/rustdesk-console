import {
  IsString,
  IsOptional,
  IsInt,
  IsNotEmpty,
  Min,
  Max,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from './query.dto';

/**
 * Address book rule pagination query parameters
 * Used to query the address book rule list
 */
export class RuleQueryDto extends PaginationDto {
  /**
   * Address book GUID
   * Specifies the address book whose rules are queried
   */
  @IsString()
  @IsNotEmpty()
  ab: string;
}

/**
 * Create rule request body
 * Used to add a new address book rule
 */
export class CreateRuleDto {
  /**
   * Address book GUID
   * Specifies the address book the rule belongs to
   */
  @IsString()
  @IsNotEmpty()
  guid: string;

  /**
   * Target user GUID
   * Required when the rule type is "user"
   * Mutually exclusive with group
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  user?: string;

  /**
   * Target group GUID
   * Required when the rule type is "group"
   * Mutually exclusive with user
   */
  @IsOptional()
  @IsUUID('4')
  group?: string;

  /**
   * Permission level
   * 1 - Read-only permission (ro)
   * 2 - Read-write permission (rw)
   * 3 - Full control (full)
   * Default value: 1
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  rule?: number = 1;
}

/**
 * Update rule request body
 * Used to modify an existing rule
 */
export class UpdateRuleDto {
  /**
   * Rule GUID
   * Specifies the rule to update
   */
  @IsString()
  @IsNotEmpty()
  guid: string;

  /**
   * New permission level
   * 1 - Read-only permission (ro)
   * 2 - Read-write permission (rw)
   * 3 - Full control (full)
   */
  @IsInt()
  @Min(1)
  @Max(3)
  rule: number;
}
