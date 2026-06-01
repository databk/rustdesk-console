import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UserService } from './user.service';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CreateUserDto,
  InviteUserDto,
  UpdateUserDto,
  UpdateUserSecurityDto,
  UpdateCurrentUserDto,
  UserQueryDto,
  BatchStatusDto,
  BatchSecurityDto,
  BatchSessionsDto,
} from './dto/user.dto';

@Controller()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('users')
  async getAccessibleUsers(
    @CurrentUser('id') userId: string,
    @CurrentUser('isAdmin') isAdmin: boolean,
    @Query() query: UserQueryDto,
  ) {
    return this.userService.getAccessibleUsers(userId, query, isAdmin);
  }

  @Post('users')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async createUser(@Body() dto: CreateUserDto) {
    return this.userService.createUser(dto);
  }

  @Patch('users/me')
  @HttpCode(HttpStatus.OK)
  async updateCurrentUser(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateCurrentUserDto,
  ) {
    return this.userService.updateCurrentUser(userId, dto);
  }

  @Post('users/invite')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async inviteUser(@Body() dto: InviteUserDto) {
    return this.userService.inviteUser(dto);
  }

  @Patch('users/batch/status')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async batchUpdateStatus(@Body() dto: BatchStatusDto) {
    return this.userService.batchUpdateStatus(dto);
  }

  @Patch('users/batch/security')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async batchUpdateSecurity(@Body() dto: BatchSecurityDto) {
    return this.userService.batchUpdateSecurity(dto);
  }

  @Delete('users/batch/sessions')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async batchDeleteSessions(@Body() dto: BatchSessionsDto) {
    return this.userService.forceLogout(dto.user_guids);
  }

  @Get('users/:guid')
  @UseGuards(AdminGuard)
  async getUser(@Param('guid') guid: string) {
    return this.userService.getUser(guid);
  }

  @Patch('users/:guid')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async updateUser(@Param('guid') guid: string, @Body() dto: UpdateUserDto) {
    return this.userService.updateUser(guid, dto);
  }

  @Delete('users/:guid')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async deleteUser(@Param('guid') guid: string) {
    await this.userService.deleteUser(guid);
    return { message: '用户已删除' };
  }

  @Patch('users/:guid/security')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async updateUserSecurity(
    @Param('guid') guid: string,
    @Body() dto: UpdateUserSecurityDto,
  ) {
    await this.userService.updateUserSecurity(guid, dto);
    return { message: '安全设置已更新' };
  }

  @Delete('users/:guid/sessions')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async deleteUserSessions(@Param('guid') guid: string) {
    return this.userService.forceLogout([guid]);
  }
}
