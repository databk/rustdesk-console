import { IsNumber, Min, IsInt, IsString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * User query DTO
 * Used to fetch the list of accessible users
 */
export class UserQueryDto {
  @IsNumber()
  @Min(1)
  @IsInt()
  @Type(() => Number)
  current: number;

  @IsNumber()
  @Min(1)
  @IsInt()
  @Type(() => Number)
  pageSize: number;

  @IsString()
  @IsOptional()
  accessible?: string; // an empty string means fetch accessible users

  @IsString()
  @IsOptional()
  status?: string; // '1' means only fetch users with normal status

  @IsString()
  @IsOptional()
  name?: string; // user name filter; supports fuzzy match

  @IsString()
  @IsOptional()
  group_name?: string; // group name filter; supports fuzzy match
}
