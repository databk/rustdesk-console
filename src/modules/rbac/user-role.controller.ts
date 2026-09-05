import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireSuperAdmin } from './decorators/require-permission.decorator';
import { ReplaceUserRolesDto } from './dto/user-role.dto';
import { UserRoleService } from './services/user-role.service';

@Controller('users')
@RequireSuperAdmin()
export class UserRoleController {
  constructor(private readonly userRoleService: UserRoleService) {}

  @Get(':guid/roles')
  getRoles(@Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string) {
    return this.userRoleService.getUserRoles(guid);
  }

  @Put(':guid/roles')
  @HttpCode(HttpStatus.OK)
  replaceRoles(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Body() dto: ReplaceUserRolesDto,
    @CurrentUser('id') actorGuid: string,
  ) {
    return this.userRoleService.replaceUserRoles(guid, dto, actorGuid);
  }

  @Delete(':guid/roles/:roleGuid')
  @HttpCode(HttpStatus.OK)
  async revokeRole(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Param('roleGuid', new ParseUUIDPipe({ version: '4' })) roleGuid: string,
    @CurrentUser('id') actorGuid: string,
  ) {
    return this.userRoleService.revokeUserRole(guid, roleGuid, actorGuid);
  }
}
