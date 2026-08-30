import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import {
  CreateUserGroupDto,
  UpdateUserGroupDto,
  UserGroupMembersDto,
  UserGroupQueryDto,
} from './dto/user-group.dto';
import { UserGroupService } from './user-group.service';

@Controller('user-groups')
export class UserGroupController {
  constructor(private readonly userGroupService: UserGroupService) {}

  @Get()
  @RequirePermission('user_groups.view')
  getGroups(@Query() query: UserGroupQueryDto) {
    return this.userGroupService.getGroups(query);
  }

  @Post()
  @RequirePermission('user_groups.create')
  @HttpCode(HttpStatus.OK)
  createGroup(@Body() dto: CreateUserGroupDto) {
    return this.userGroupService.createGroup(dto);
  }

  @Put(':guid')
  @RequirePermission('user_groups.edit')
  @HttpCode(HttpStatus.OK)
  updateGroup(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Body() dto: UpdateUserGroupDto,
  ) {
    return this.userGroupService.updateGroup(guid, dto);
  }

  @Delete(':guid')
  @RequirePermission('user_groups.delete')
  @HttpCode(HttpStatus.OK)
  deleteGroup(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @CurrentUser('id') actorGuid: string,
  ) {
    return this.userGroupService.deleteGroup(guid, actorGuid);
  }

  @Get(':guid/users')
  @RequirePermission('user_groups.membership')
  getGroupUsers(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Query() query: UserGroupQueryDto,
  ) {
    return this.userGroupService.getGroupUsers(guid, query);
  }

  @Post(':guid/users')
  @RequirePermission('user_groups.membership')
  @HttpCode(HttpStatus.OK)
  moveUsers(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Body() dto: UserGroupMembersDto,
    @CurrentUser('id') actorGuid: string,
  ) {
    return this.userGroupService.moveUsers(guid, dto.user_guids, actorGuid);
  }
}
