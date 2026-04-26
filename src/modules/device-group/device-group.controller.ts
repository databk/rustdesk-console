import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
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
  async getAccessibleDeviceGroups(
    @CurrentUser('id') userId: string,
    @CurrentUser('isAdmin') isAdmin: boolean,
    @Query() query: DeviceGroupQueryDto,
  ) {
    return this.deviceGroupService.getAccessibleDeviceGroups(
      userId,
      query,
      isAdmin,
    );
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
  async getDeviceGroups(
    @CurrentUser('id') userId: string,
    @CurrentUser('isAdmin') isAdmin: boolean,
    @Query() query: DeviceGroupQueryDto,
  ) {
    return this.deviceGroupService.getAccessibleDeviceGroups(
      userId,
      query,
      isAdmin,
    );
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
  async createDeviceGroup(
    @Body() body: { name: string; note?: string; allowed_incomings?: any[] },
  ) {
    return this.deviceGroupService.createDeviceGroup(
      body.name,
      body.note,
      body.allowed_incomings,
    );
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
  async updateDeviceGroup(
    @Param('guid') guid: string,
    @Body()
    body: {
      name?: string;
      note?: string;
      allowed_incomings?: any[];
    },
  ) {
    return this.deviceGroupService.updateDeviceGroup(
      guid,
      body.name,
      body.note,
      body.allowed_incomings,
    );
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
  async addDevicesToGroup(@Param('guid') guid: string, @Body() body: string[]) {
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
  async removeDevicesFromGroup(
    @Param('guid') guid: string,
    @Body() body: string[],
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
  async enableDevice(@Param('guid') guid: string) {
    await this.deviceGroupService.enableDevice(guid);
    return { message: '设备已启用' };
  }

  /**
   * 批量启用/禁用设备
   * 管理员可以批量启用或禁用设备
   *
   * @param body 包含设备GUID列表和禁用标志
   * @returns 操作结果
   */
  @Put('enable-peers')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async enablePeers(
    @Body() body: { data: { rows: string[]; disable: boolean } },
  ) {
    const { rows, disable } = body.data;
    await this.deviceGroupService.setPeersStatus(rows, !disable);
    return { message: disable ? '设备已禁用' : '设备已启用' };
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
  async assignDevice(
    @Param('guid') guid: string,
    @Body()
    body: {
      type: string;
      value: string;
    },
  ) {
    await this.deviceGroupService.assignDevice(guid, body.type, body.value);
    return { message: '设备属性已分配' };
  }
}
