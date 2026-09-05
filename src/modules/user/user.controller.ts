import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { UserService } from './user.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { RbacAuthorizationService } from '../rbac/services/rbac-authorization.service';
import {
  CreateUserDto,
  InviteUserDto,
  AcceptInvitationDto,
  VerifyInvitationDto,
  UpdateUserDto,
  UpdateUserSecurityDto,
  UpdateCurrentUserDto,
  UserQueryDto,
  BatchStatusDto,
  BatchSecurityDto,
  BatchSessionsDto,
  ChangePasswordDto,
} from './dto/user.dto';

@Controller()
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly rbacAuthorizationService: RbacAuthorizationService,
  ) {}

  @Get('users')
  async getAccessibleUsers(
    @CurrentUser('id') userId: string,
    @Query() query: UserQueryDto,
  ) {
    const currentUser =
      await this.rbacAuthorizationService.getCurrentUser(userId);
    return this.userService.getAccessibleUsers(
      userId,
      query,
      currentUser.isAdmin,
    );
  }

  @Post('users')
  @RequirePermission('users.create')
  @HttpCode(HttpStatus.OK)
  async createUser(
    @Body() dto: CreateUserDto,
    @CurrentUser('id') actorGuid: string,
  ) {
    if (dto.user_group_guid !== undefined) {
      await this.rbacAuthorizationService.requirePermission(
        actorGuid,
        'user_groups.membership',
      );
    }
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

  @Patch('users/me/password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.userService.changePassword(userId, dto);
  }

  @Post('users/me/avatar')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseInterceptors(
    FileInterceptor('avatar', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  @HttpCode(HttpStatus.OK)
  async uploadAvatar(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('请上传头像文件');
    }
    return this.userService.uploadAvatar(userId, file);
  }

  @Delete('users/me/avatar')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async deleteAvatar(@CurrentUser('id') userId: string) {
    return this.userService.deleteAvatar(userId);
  }

  @Post('users/invite')
  @RequirePermission('users.create')
  @HttpCode(HttpStatus.OK)
  async inviteUser(
    @Body() dto: InviteUserDto,
    @CurrentUser('id') actorGuid: string,
  ) {
    if (dto.user_group_guid !== undefined) {
      await this.rbacAuthorizationService.requirePermission(
        actorGuid,
        'user_groups.membership',
      );
    }
    return this.userService.inviteUser(dto);
  }

  @Public()
  @Post('invitations/verify')
  @HttpCode(HttpStatus.OK)
  async verifyInvitation(@Body() dto: VerifyInvitationDto) {
    return this.userService.verifyInvitation(dto.token);
  }

  @Public()
  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  async acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.userService.acceptInvitation(dto);
  }

  @Patch('users/batch/status')
  @RequirePermission('users.status')
  @HttpCode(HttpStatus.OK)
  async batchUpdateStatus(
    @Body() dto: BatchStatusDto,
    @CurrentUser('id') actorGuid: string,
  ) {
    await this.rbacAuthorizationService.assertUsersMutation(
      actorGuid,
      dto.user_guids,
      'users.status',
    );
    return this.userService.batchUpdateStatus(dto);
  }

  @Patch('users/batch/security')
  @RequirePermission('users.security')
  @HttpCode(HttpStatus.OK)
  async batchUpdateSecurity(
    @Body() dto: BatchSecurityDto,
    @CurrentUser('id') actorGuid: string,
  ) {
    await this.rbacAuthorizationService.assertUsersMutation(
      actorGuid,
      dto.user_guids,
      'users.security',
    );
    return this.userService.batchUpdateSecurity(dto);
  }

  @Delete('users/batch/sessions')
  @RequirePermission('users.force_logout')
  @HttpCode(HttpStatus.OK)
  async batchDeleteSessions(
    @Body() dto: BatchSessionsDto,
    @CurrentUser('id') actorGuid: string,
  ) {
    await this.rbacAuthorizationService.assertUsersMutation(
      actorGuid,
      dto.user_guids,
      'users.force_logout',
    );
    return this.userService.forceLogout(dto.user_guids);
  }

  @Get('users/:guid')
  @RequirePermission('users.view')
  async getUser(@Param('guid') guid: string) {
    return this.userService.getUser(guid);
  }

  @Patch('users/:guid')
  @RequirePermission('users.edit')
  @HttpCode(HttpStatus.OK)
  async updateUser(
    @Param('guid') guid: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('id') actorGuid: string,
  ) {
    await this.rbacAuthorizationService.assertUserMutation(
      actorGuid,
      guid,
      'users.edit',
      dto,
    );
    return this.userService.updateUser(guid, dto);
  }

  @Delete('users/:guid')
  @RequirePermission('users.delete')
  @HttpCode(HttpStatus.OK)
  async deleteUser(
    @Param('guid') guid: string,
    @CurrentUser('id') actorGuid: string,
  ) {
    await this.rbacAuthorizationService.assertUserMutation(
      actorGuid,
      guid,
      'users.delete',
    );
    await this.userService.deleteUser(guid);
    return { message: '用户已删除' };
  }

  @Patch('users/:guid/security')
  @RequirePermission('users.security')
  @HttpCode(HttpStatus.OK)
  async updateUserSecurity(
    @Param('guid') guid: string,
    @Body() dto: UpdateUserSecurityDto,
    @CurrentUser('id') actorGuid: string,
  ) {
    await this.rbacAuthorizationService.assertUserMutation(
      actorGuid,
      guid,
      'users.security',
    );
    await this.userService.updateUserSecurity(guid, dto);
    return { message: '安全设置已更新' };
  }

  @Delete('users/:guid/sessions')
  @RequirePermission('users.force_logout')
  @HttpCode(HttpStatus.OK)
  async deleteUserSessions(
    @Param('guid') guid: string,
    @CurrentUser('id') actorGuid: string,
  ) {
    await this.rbacAuthorizationService.assertUserMutation(
      actorGuid,
      guid,
      'users.force_logout',
    );
    return this.userService.forceLogout([guid]);
  }
}
