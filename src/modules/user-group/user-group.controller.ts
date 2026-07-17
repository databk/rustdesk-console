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
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import {
  CreateUserGroupDto,
  UpdateUserGroupDto,
  UserGroupMembersDto,
  UserGroupQueryDto,
} from './dto/user-group.dto';
import { UserGroupService } from './user-group.service';

@Controller('user-groups')
@UseGuards(AdminGuard)
export class UserGroupController {
  constructor(private readonly userGroupService: UserGroupService) {}

  @Get()
  getGroups(@Query() query: UserGroupQueryDto) {
    return this.userGroupService.getGroups(query);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  createGroup(@Body() dto: CreateUserGroupDto) {
    return this.userGroupService.createGroup(dto);
  }

  @Put(':guid')
  @HttpCode(HttpStatus.OK)
  updateGroup(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Body() dto: UpdateUserGroupDto,
  ) {
    return this.userGroupService.updateGroup(guid, dto);
  }

  @Delete(':guid')
  @HttpCode(HttpStatus.OK)
  deleteGroup(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
  ) {
    return this.userGroupService.deleteGroup(guid);
  }

  @Get(':guid/users')
  getGroupUsers(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Query() query: UserGroupQueryDto,
  ) {
    return this.userGroupService.getGroupUsers(guid, query);
  }

  @Post(':guid/users')
  @HttpCode(HttpStatus.OK)
  moveUsers(
    @Param('guid', new ParseUUIDPipe({ version: '4' })) guid: string,
    @Body() dto: UserGroupMembersDto,
  ) {
    return this.userGroupService.moveUsers(guid, dto.user_guids);
  }
}
