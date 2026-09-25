import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from './decorators/require-permission.decorator';
import { ReplaceUserRolesDto } from './dto/user-role.dto';
import { UserRoleService } from './services/user-role.service';
import { SkipConsoleAudit } from './decorators/skip-console-audit.decorator';

@Controller('users')
@SkipConsoleAudit()
export class UserRoleController {
  constructor(private readonly userRoleService: UserRoleService) {}

  @Get(':guid/roles')
  @RequirePermission('roles.assign')
  getRoles(@Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string) {
    return this.userRoleService.getUserRoles(guid);
  }

  @Get(':guid/roles/eligibility')
  @RequirePermission('roles.assign')
  getEligibility(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @CurrentUser('id') actorGuid: string,
  ) {
    return this.userRoleService.getRoleEligibility(guid, actorGuid);
  }

  @Put(':guid/roles')
  @RequirePermission('roles.assign')
  @HttpCode(HttpStatus.OK)
  replaceRoles(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Body() dto: ReplaceUserRolesDto,
    @CurrentUser('id') actorGuid: string,
  ) {
    return this.userRoleService.replaceUserRoles(guid, dto, actorGuid);
  }
}
