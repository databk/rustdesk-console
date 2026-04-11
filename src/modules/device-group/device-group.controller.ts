import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards, ValidationPipe, UsePipes, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { DeviceGroupService } from './device-group.service';
import { PeerService } from './peer.service';
import { DeviceGroupQueryDto } from './dto/device-group.dto';
import { PeerQueryDto } from './dto/peer.dto';
import { UserQueryDto } from './dto/user.dto';
import { DeviceQueryDto } from './dto/device.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';

/**
 * 设备组控制器
 * 管理设备组相关的客户端接口，提供可访问资源的查询功能
 *
 * 端点数量：3个
 * - GET /api/device-group/accessible - 获取可访问的设备组列表
 * - GET /api/peers - 获取可访问的设备列表
 * - GET /api/users - 获取可访问的用户列表
 */
@ApiTags('设备组')
@ApiBearerAuth('JWT-auth')
@Controller()
export class DeviceGroupController {
  constructor(
    private readonly deviceGroupService: DeviceGroupService,
    private readonly peerService: PeerService,
  ) {}

  // ============ 客户端 API 接口 ============

  /**
   * 获取当前用户可访问的设备组列表
   * 根据用户权限获取可访问的设备组列表，管理员可以看到所有设备组
   *
   * 功能说明：
   * - 普通用户只能看到自己有权限访问的设备组
   * - 管理员可以看到所有设备组
   * - 支持分页查询
   * - 支持按名称搜索
   *
   * @param userId 当前用户ID（从JWT令牌中提取）
   * @param isAdmin 是否为管理员（从JWT令牌中提取）
   * @param query 查询参数（分页、搜索等）
   * @returns 可访问的设备组列表（分页）
   */
  @Get('device-group/accessible')
  @ApiOperation({ summary: '获取可访问的设备组', description: '获取当前用户有权限访问的设备组列表，支持分页和搜索' })
  @ApiResponse({ status: 200, description: '成功返回设备组列表', type: Object })
  @ApiQuery({ name: 'page', required: false, type: Number, description: '页码' })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: '每页数量' })
  @ApiQuery({ name: 'search', required: false, type: String, description: '搜索关键词' })
  async getAccessibleDeviceGroups(
    @CurrentUser('id') userId: string,
    @CurrentUser('isAdmin') isAdmin: boolean,
    @Query() query: DeviceGroupQueryDto,
  ) {
    return this.deviceGroupService.getAccessibleDeviceGroups(userId, query, isAdmin);
  }

  /**
   * 获取当前用户可访问的设备列表
   * 根据用户权限获取可访问的设备列表，管理员可以看到所有设备
   *
   * 功能说明：
   * - 普通用户只能看到自己有权限访问的设备
   * - 管理员可以看到所有设备
   * - 支持分页查询
   * - 支持按名称搜索
   * - 支持按状态过滤
   *
   * @param userId 当前用户ID（从JWT令牌中提取）
   * @param isAdmin 是否为管理员（从JWT令牌中提取）
   * @param query 查询参数（分页、搜索、状态等）
   * @returns 可访问的设备列表（分页）
   */
  @Get('peers')
  @ApiOperation({ summary: '获取可访问的设备列表', description: '获取当前用户有权限访问的设备列表，支持分页、搜索和状态过滤' })
  @ApiResponse({ status: 200, description: '成功返回设备列表', type: Object })
  @ApiQuery({ name: 'page', required: false, type: Number, description: '页码' })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: '每页数量' })
  @ApiQuery({ name: 'search', required: false, type: String, description: '搜索关键词' })
  @ApiQuery({ name: 'status', required: false, type: String, description: '设备状态' })
  async getAccessiblePeers(
    @CurrentUser('id') userId: string,
    @CurrentUser('isAdmin') isAdmin: boolean,
    @Query() query: PeerQueryDto,
  ) {
    return this.peerService.getAccessiblePeers(userId, query, isAdmin);
  }

  /**
   * 获取当前用户可访问的用户列表
   * 根据用户权限获取可访问的用户列表，管理员可以看到所有用户
   *
   * 功能说明：
   * - 普通用户只能看到自己有权限访问的用户
   * - 管理员可以看到所有用户
   * - 支持分页查询
   * - 支持按名称搜索
   * - 支持按状态过滤
   *
   * @param userId 当前用户ID（从JWT令牌中提取）
   * @param isAdmin 是否为管理员（从JWT令牌中提取）
   * @param query 查询参数（分页、搜索、状态等）
   * @returns 可访问的用户列表（分页）
   */
  @Get('users')
  @ApiOperation({ summary: '获取可访问的用户列表', description: '获取当前用户有权限访问的用户列表，支持分页和搜索' })
  @ApiResponse({ status: 200, description: '成功返回用户列表', type: Object })
  @ApiQuery({ name: 'page', required: false, type: Number, description: '页码' })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: '每页数量' })
  @ApiQuery({ name: 'search', required: false, type: String, description: '搜索关键词' })
  @ApiQuery({ name: 'status', required: false, type: String, description: '用户状态' })
  async getAccessibleUsers(
    @CurrentUser('id') userId: string,
    @CurrentUser('isAdmin') isAdmin: boolean,
    @Query() query: UserQueryDto,
  ) {
    return this.deviceGroupService.getAccessibleUsers(userId, query, isAdmin);
  }

  // ============ 管理员 API 接口 ============

  /**
   * 获取设备组列表
   * 管理员可以查看所有设备组
   *
   * @param userId 当前用户ID（从JWT令牌中提取）
   * @param isAdmin 是否为管理员（从JWT令牌中提取）
   * @param query 查询参数（分页、名称过滤）
   * @returns 设备组列表（分页）
   */
  @Get('device-groups')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '获取所有设备组（管理员）', description: '管理员查看系统中的所有设备组' })
  @ApiResponse({ status: 200, description: '成功返回设备组列表', type: Object })
  @ApiQuery({ name: 'page', required: false, type: Number, description: '页码' })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: '每页数量' })
  @ApiQuery({ name: 'search', required: false, type: String, description: '搜索关键词' })
  async getDeviceGroups(
    @CurrentUser('id') userId: string,
    @CurrentUser('isAdmin') isAdmin: boolean,
    @Query() query: DeviceGroupQueryDto,
  ) {
    return this.deviceGroupService.getAccessibleDeviceGroups(userId, query, isAdmin);
  }

  /**
   * 创建设备组
   * 管理员可以创建新的设备组
   *
   * @param body 设备组数据
   * @returns 创建结果
   */
  @Post('device-groups')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '创建设备组（管理员）', description: '创建新的设备组，用于组织和管理设备' })
  @ApiResponse({ status: 201, description: '设备组创建成功', type: Object })
  @ApiBody({
    schema: {
      example: {
        name: '新设备组',
        note: '设备组描述',
        allowed_incomings: ['option1', 'option2']
      }
    },
    description: '设备组信息'
  })
  async createDeviceGroup(
    @Body() body: {
      name: string;
      note?: string;
      allowed_incomings?: any[];
    }
  ) {
    return this.deviceGroupService.createDeviceGroup(body.name, body.note, body.allowed_incomings);
  }

  /**
   * 更新设备组
   * 管理员可以更新设备组信息
   *
   * @param guid 设备组GUID
   * @param body 更新数据
   * @returns 更新结果
   */
  @Patch('device-groups/:guid')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '更新设备组（管理员）', description: '更新指定设备组的名称、备注等信息' })
  @ApiResponse({ status: 200, description: '更新成功', type: Object })
  @ApiParam({ name: 'guid', description: '设备组 GUID', type: 'string' })
  @ApiBody({
    schema: {
      example: {
        name: '更新后的名称',
        note: '更新的备注',
        allowed_incomings: ['option1']
      }
    },
    description: '要更新的字段'
  })
  async updateDeviceGroup(
    @Param('guid') guid: string,
    @Body() body: {
      name?: string;
      note?: string;
      allowed_incomings?: any[];
    }
  ) {
    return this.deviceGroupService.updateDeviceGroup(guid, body.name, body.note, body.allowed_incomings);
  }

  /**
   * 删除设备组
   * 管理员可以删除设备组
   *
   * @param guid 设备组GUID
   * @returns 删除结果
   */
  @Delete('device-groups/:guid')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除设备组（管理员）', description: '删除指定的设备组及其关联数据' })
  @ApiResponse({ status: 200, description: '删除成功', schema: { example: { message: '设备组删除成功' } } })
  @ApiParam({ name: 'guid', description: '设备组 GUID', type: 'string' })
  async deleteDeviceGroup(@Param('guid') guid: string) {
    await this.deviceGroupService.deleteDeviceGroup(guid);
    return { message: '设备组删除成功' };
  }

  /**
   * 添加设备到设备组
   * 管理员可以将设备添加到设备组
   *
   * @param guid 设备组GUID
   * @param body 设备ID列表
   * @returns 添加结果
   */
  @Post('device-groups/:guid')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '添加设备到设备组（管理员）', description: '将一个或多个设备添加到指定设备组' })
  @ApiResponse({ status: 200, description: '添加成功', type: Object })
  @ApiParam({ name: 'guid', description: '设备组 GUID', type: 'string' })
  @ApiBody({
    schema: {
      example: ['device-uuid-1', 'device-uuid-2']
    },
    description: '要添加的设备 ID 列表'
  })
  async addDevicesToGroup(
    @Param('guid') guid: string,
    @Body() body: string[]
  ) {
    return this.deviceGroupService.addDevicesToGroup(guid, body);
  }

  /**
   * 从设备组中移除设备
   * 管理员可以从设备组中移除设备
   *
   * @param guid 设备组GUID
   * @param body 设备ID列表
   * @returns 移除结果
   */
  @Delete('device-groups/:guid/devices')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '从设备组移除设备（管理员）', description: '从指定设备组中移除一个或多个设备' })
  @ApiResponse({ status: 200, description: '移除成功', type: Object })
  @ApiParam({ name: 'guid', description: '设备组 GUID', type: 'string' })
  @ApiBody({
    schema: {
      example: ['device-uuid-1', 'device-uuid-2']
    },
    description: '要移除的设备 ID 列表'
  })
  async removeDevicesFromGroup(
    @Param('guid') guid: string,
    @Body() body: string[]
  ) {
    return this.deviceGroupService.removeDevicesFromGroup(guid, body);
  }

  /**
   * 获取设备列表
   * 管理员可以查看所有设备
   *
   * @param userId 当前用户ID（从JWT令牌中提取）
   * @param isAdmin 是否为管理员（从JWT令牌中提取）
   * @param query 查询参数（分页、过滤）
   * @returns 设备列表（分页）
   */
  @Get('devices')
  @ApiOperation({ summary: '获取设备列表', description: '获取系统中所有设备的列表，支持分页和状态过滤' })
  @ApiResponse({ status: 200, description: '成功返回设备列表', type: Object })
  @ApiQuery({ name: 'page', required: false, type: Number, description: '页码' })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: '每页数量' })
  @ApiQuery({ name: 'search', required: false, type: String, description: '搜索关键词' })
  @ApiQuery({ name: 'status', required: false, type: String, description: '设备状态' })
  async getDevices(
    @CurrentUser('id') userId: string,
    @CurrentUser('isAdmin') isAdmin: boolean,
    @Query() query: DeviceQueryDto,
  ) {
    return this.deviceGroupService.getDevices(userId, query, isAdmin);
  }

  /**
   * 禁用设备
   * 管理员可以禁用设备
   *
   * @param guid 设备GUID
   * @returns 禁用结果
   */
  @Post('devices/:guid/disable')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '禁用设备（管理员）', description: '禁用指定设备，使其无法连接' })
  @ApiResponse({ status: 200, description: '禁用成功', schema: { example: { message: '设备已禁用' } } })
  @ApiParam({ name: 'guid', description: '设备 GUID', type: 'string' })
  async disableDevice(@Param('guid') guid: string) {
    await this.deviceGroupService.disableDevice(guid);
    return { message: '设备已禁用' };
  }

  /**
   * 启用设备
   * 管理员可以启用设备
   *
   * @param guid 设备GUID
   * @returns 启用结果
   */
  @Post('devices/:guid/enable')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启用设备（管理员）', description: '重新启用已禁用的设备' })
  @ApiResponse({ status: 200, description: '启用成功', schema: { example: { message: '设备已启用' } } })
  @ApiParam({ name: 'guid', description: '设备 GUID', type: 'string' })
  async enableDevice(@Param('guid') guid: string) {
    await this.deviceGroupService.enableDevice(guid);
    return { message: '设备已启用' };
  }

  /**
   * 删除设备
   * 管理员可以删除设备
   *
   * @param guid 设备GUID
   * @returns 删除结果
   */
  @Delete('devices/:guid')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除设备（管理员）', description: '永久删除指定设备及其相关数据' })
  @ApiResponse({ status: 200, description: '删除成功', schema: { example: { message: '设备已删除' } } })
  @ApiParam({ name: 'guid', description: '设备 GUID', type: 'string' })
  async deleteDevice(@Param('guid') guid: string) {
    await this.deviceGroupService.deleteDevice(guid);
    return { message: '设备已删除' };
  }

  /**
   * 分配设备属性
   * 管理员可以分配设备属性
   *
   * @param guid 设备GUID
   * @param body 分配数据
   * @returns 分配结果
   */
  @Post('devices/:guid/assign')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '分配设备属性（管理员）', description: '为设备分配自定义属性（如标签、分组等）' })
  @ApiResponse({ status: 200, description: '分配成功', schema: { example: { message: '设备属性已分配' } } })
  @ApiParam({ name: 'guid', description: '设备 GUID', type: 'string' })
  @ApiBody({
    schema: {
      example: {
        type: 'tag',
        value: '重要设备'
      }
    },
    description: '属性类型和值'
  })
  async assignDevice(
    @Param('guid') guid: string,
    @Body() body: {
      type: string;
      value: string;
    }
  ) {
    await this.deviceGroupService.assignDevice(guid, body.type, body.value);
    return { message: '设备属性已分配' };
  }
}
