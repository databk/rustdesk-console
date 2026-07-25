import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';

export class AssignRolePermissionsDto {
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  permission_codes: string[];
}
