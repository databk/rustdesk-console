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
  Logger,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { ConsoleAuditAction } from '../rbac/decorators/console-audit-action.decorator';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';
import {
  CreateUserGroupDto,
  UpdateUserGroupDto,
  UserGroupMembersDto,
  UserGroupQueryDto,
} from './dto/user-group.dto';
import { UserGroupService } from './user-group.service';

@Controller('user-groups')
export class UserGroupController {
  private readonly logger = new Logger(UserGroupController.name);

  constructor(
    private readonly userGroupService: UserGroupService,
    private readonly auditService: RbacAuditService,
  ) {}

  @Get()
  @RequirePermission('user_groups.view')
  getGroups(@Query() query: UserGroupQueryDto) {
    return this.userGroupService.getGroups(query);
  }

  @Post()
  @RequirePermission('user_groups.create')
  @ConsoleAuditAction('user_group.create')
  @HttpCode(HttpStatus.OK)
  createGroup(@Body() dto: CreateUserGroupDto) {
    return this.userGroupService.createGroup(dto);
  }

  @Put(':guid')
  @RequirePermission('user_groups.edit')
  @ConsoleAuditAction('user_group.update')
  @HttpCode(HttpStatus.OK)
  updateGroup(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Body() dto: UpdateUserGroupDto,
  ) {
    return this.userGroupService.updateGroup(guid, dto);
  }

  @Delete(':guid')
  @RequirePermission('user_groups.delete')
  @ConsoleAuditAction('user_group.delete')
  @HttpCode(HttpStatus.OK)
  deleteGroup(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @CurrentUser('id') actorGuid: string,
  ) {
    return this.userGroupService.deleteGroup(guid, actorGuid);
  }

  @Get(':guid/users')
  @RequirePermission('user_groups.view')
  getGroupUsers(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Query() query: UserGroupQueryDto,
  ) {
    return this.userGroupService.getGroupUsers(guid, query);
  }

  @Post(':guid/users')
  @RequirePermission('user_groups.membership')
  @ConsoleAuditAction('user_group.member_add')
  @HttpCode(HttpStatus.OK)
  async moveUsers(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Body() dto: UserGroupMembersDto,
    @CurrentUser('id') actorGuid: string,
  ) {
    const result = await this.userGroupService.moveUsers(
      guid,
      dto.user_guids,
      actorGuid,
    );
    try {
      for (const sourceGuid of result.source_group_guids) {
        await this.auditService.record({
          actorUserGuid: actorGuid,
          targetType: 'user_group',
          targetGuid: sourceGuid,
          action: 'user_group.member_remove',
          result: 'allowed',
          afterState: { user_guids: dto.user_guids },
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Unable to persist group move audit: ${message}`);
    }
    return {
      message: result.message,
      moved_user_count: result.moved_user_count,
    };
  }
}
