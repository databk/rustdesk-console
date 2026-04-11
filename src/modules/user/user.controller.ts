import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { UserService } from './user.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
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
@ApiTags('用户管理')
@ApiBearerAuth('JWT-auth')
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
  @ApiOperation({ summary: '创建新用户', description: '管理员创建新的系统用户' })
  @ApiResponse({ status: 200, description: '用户创建成功', type: Object })
  @ApiBody({
    schema: {
      example: {
        name: 'newuser',
        password: 'password123',
        group_name: '默认组',
        email: 'user@example.com',
        note: '备注信息'
      }
    },
    description: '用户信息'
  })
  async createUser(@Body() createUserDto: {
    name: string;
    password: string;
    group_name?: string;
    email?: string;
    note?: string;
  }) {
    return this.userService.createUser(createUserDto);
  }

  /**
   * 邀请用户
   * @param inviteUserDto 用户邀请数据
   * @returns 邀请结果
   */
  @Post('users/invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '邀请用户', description: '通过邮件邀请用户注册（需要配置邮件服务）' })
  @ApiResponse({ status: 200, description: '邀请发送成功', type: Object })
  @ApiBody({
    schema: {
      example: {
        email: 'invite@example.com',
        name: '被邀请人',
        group_name: '默认组',
        note: '邀请备注'
      }
    },
    description: '邀请信息'
  })
  async inviteUser(@Body() inviteUserDto: {
    email: string;
    name: string;
    group_name?: string;
    note?: string;
  }) {
    return this.userService.inviteUser(inviteUserDto);
  }

  /**
   * 禁用用户
   * @param guid 用户GUID
   */
  @Post('users/:guid/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '禁用用户', description: '禁用指定用户，禁止其登录系统' })
  @ApiResponse({ status: 200, description: '用户已禁用', schema: { example: { message: '用户已禁用' } } })
  @ApiParam({ name: 'guid', description: '用户 GUID', type: 'string' })
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
  @ApiOperation({ summary: '启用用户', description: '重新启用已禁用的用户' })
  @ApiResponse({ status: 200, description: '用户已启用', schema: { example: { message: '用户已启用' } } })
  @ApiParam({ name: 'guid', description: '用户 GUID', type: 'string' })
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
  @ApiOperation({ summary: '删除用户', description: '永久删除指定用户及其所有数据' })
  @ApiResponse({ status: 200, description: '用户已删除', schema: { example: { message: '用户已删除' } } })
  @ApiParam({ name: 'guid', description: '用户 GUID', type: 'string' })
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
  @ApiOperation({ summary: '设置2FA强制', description: '强制指定用户启用双因素认证（2FA）' })
  @ApiResponse({ status: 200, description: '设置成功', schema: { example: { message: '2FA设置成功' } } })
  @ApiBody({
    schema: {
      example: {
        user_guids: ['uuid1', 'uuid2'],
        enforce: true,
        url: 'https://example.com/totp'
      }
    },
    description: '2FA 设置参数'
  })
  async setTfaEnforce(@Body() body: {
    user_guids: string[];
    enforce: boolean;
    url: string;
  }) {
    await this.userService.setTfaEnforce(body.user_guids, body.enforce, body.url);
    return { message: '2FA设置成功' };
  }

  /**
   * 禁用登录验证
   * @param body 禁用数据
   */
  @Put('users/disable_login_verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '禁用登录验证', description: '为指定用户禁用邮箱或2FA登录验证' })
  @ApiResponse({ status: 200, description: '设置成功', schema: { example: { message: '登录验证已禁用' } } })
  @ApiBody({
    schema: {
      example: {
        user_guids: ['uuid1', 'uuid2'],
        type: 'email'
      }
    },
    description: '禁用类型：email 或 2fa'
  })
  async disableLoginVerification(@Body() body: {
    user_guids: string[];
    type: 'email' | '2fa';
  }) {
    await this.userService.disableLoginVerification(body.user_guids, body.type);
    return { message: '登录验证已禁用' };
  }

  /**
   * 强制登出
   * @param body 用户GUID列表
   */
  @Post('users/force-logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '强制登出', description: '强制指定用户下线，撤销其所有访问令牌' })
  @ApiResponse({ status: 200, description: '操作成功', type: Object })
  @ApiBody({
    schema: {
      example: {
        user_guids: ['uuid1', 'uuid2']
      }
    },
    description: '要强制登出的用户 GUID 列表'
  })
  async forceLogout(@Body() body: {
    user_guids: string[];
  }) {
    return this.userService.forceLogout(body.user_guids);
  }
}
