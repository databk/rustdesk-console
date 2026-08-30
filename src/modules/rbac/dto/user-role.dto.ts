import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class UserRoleAssignmentDto {
  @IsUUID('4')
  role_guid: string;

  @IsString()
  @IsIn(['global', 'device_group'])
  scope_type: 'global' | 'device_group';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  device_group_guids?: string[];
}

export class ReplaceUserRolesDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => UserRoleAssignmentDto)
  assignments: UserRoleAssignmentDto[];
}
