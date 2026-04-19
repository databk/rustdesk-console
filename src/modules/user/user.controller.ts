import {
  Controller,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UserService } from './user.service';
import { AdminGuard } from '../../common/guards/admin.guard';

/**
 * 用户控制器
 * 管理用户相关的API接口，提供用户管理功能
 *
 * 端点数量：8个
 * - POST /api/users - 创建新用户
 * - POST /api/users/invite - 邀请用户
 * - POST /api/users/:guid/disable - 禁用用户
 * - POST /api/users/:guid/enable - 启用用户
 * - DELETE /api/users/:guid - 删除用户
 * - PUT /api/users/tfa/totp/enforce - 设置2FA强制
 * - PUT /api/users/disable_login_verification - 禁用登录验证
 * - POST /api/users/force-logout - 强制登出
 */
@UseGuards(AdminGuard)
@Controller()
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * 创建新用户
   * @param createUserDto 用户创建数据
   * @returns 创建结果
   */
  @Post('users')
  @HttpCode(HttpStatus.OK)
  async createUser(
    @Body()
    createUserDto: {
      name: string;
      password: string;
      group_name?: string;
      email?: string;
      note?: string;
    },
  ) {
    return this.userService.createUser(createUserDto);
  }

  /**
   * 邀请用户
   * @param inviteUserDto 用户邀请数据
   * @returns 邀请结果
   */
  @Post('users/invite')
  @HttpCode(HttpStatus.OK)
  async inviteUser(
    @Body()
    inviteUserDto: {
      email: string;
      name: string;
      group_name?: string;
      note?: string;
    },
  ) {
    return this.userService.inviteUser(inviteUserDto);
  }

  /**
   * 禁用用户
   * @param guid 用户GUID
   */
  @Post('users/:guid/disable')
  @HttpCode(HttpStatus.OK)
  async disableUser(@Param('guid') guid: string) {
    await this.userService.disableUser(guid);
    return { message: '用户已禁用' };
  }

  /**
   * 启用用户
   * @param guid 用户GUID
   */
  @Post('users/:guid/enable')
  @HttpCode(HttpStatus.OK)
  async enableUser(@Param('guid') guid: string) {
    await this.userService.enableUser(guid);
    return { message: '用户已启用' };
  }

  /**
   * 删除用户
   * @param guid 用户GUID
   */
  @Delete('users/:guid')
  @HttpCode(HttpStatus.OK)
  async deleteUser(@Param('guid') guid: string) {
    await this.userService.deleteUser(guid);
    return { message: '用户已删除' };
  }

  /**
   * 设置2FA强制
   * @param body 设置数据
   */
  @Put('users/tfa/totp/enforce')
  @HttpCode(HttpStatus.OK)
  async setTfaEnforce(
    @Body() body: { user_guids: string[]; enforce: boolean; url: string },
  ) {
    await this.userService.setTfaEnforce(
      body.user_guids,
      body.enforce,
      body.url,
    );
    return { message: '2FA设置成功' };
  }

  /**
   * 禁用登录验证
   * @param body 禁用数据
   */
  @Put('users/disable_login_verification')
  @HttpCode(HttpStatus.OK)
  async disableLoginVerification(
    @Body() body: { user_guids: string[]; type: 'email' | '2fa' },
  ) {
    await this.userService.disableLoginVerification(body.user_guids, body.type);
    return { message: '登录验证已禁用' };
  }

  /**
   * 强制登出
   * @param body 用户GUID列表
   */
  @Post('users/force-logout')
  @HttpCode(HttpStatus.OK)
  async forceLogout(@Body() body: { user_guids: string[] }) {
    return this.userService.forceLogout(body.user_guids);
  }
}
