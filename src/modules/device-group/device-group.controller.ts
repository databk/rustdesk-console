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
  BadRequestException,
} from '@nestjs/common';
import { DeviceGroupService } from './device-group.service';
import { PeerService } from './peer.service';
import { DeviceGroupQueryDto } from './dto/device-group.dto';
import { PeerQueryDto } from './dto/peer.dto';
import { DeviceQueryDto } from './dto/device.dto';
import {
  UpdateDeviceStatusDto,
  DeviceOperationResult,
} from './dto/device-status.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { DisconnectDto } from './dto/disconnect.dto';
import { DisconnectStoreService } from '../heartbeat/services/disconnect-store.service';
import { HeartbeatService } from '../heartbeat/heartbeat.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { RbacAuthorizationService } from '../rbac/services/rbac-authorization.service';

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
    private readonly disconnectStoreService: DisconnectStoreService,
    private readonly heartbeatService: HeartbeatService,
    private readonly rbacAuthorizationService: RbacAuthorizationService,
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
    @Query() query: DeviceGroupQueryDto,
  ) {
    const currentUser =
      await this.rbacAuthorizationService.getCurrentUser(userId);
    return this.deviceGroupService.getAccessibleDeviceGroups(
      userId,
      query,
      currentUser.isAdmin,
    );
  }

  /**
   * 获取当前用户可访问的设备列表
   * 根据用户权限获取可访问的设备列表，管理员可以看到所有设备
   *
   * 功能说明：
   * - 普通用户只能看到自己有权限访问的设备
   * - 管理员可以看到所有设备
   * - 支持分页查询（current, pageSize）
   * - 支持按设备ID筛选（id，模糊匹配）
   * - 支持按设备状态筛选（status: '0'=禁用, '1'=正常）
   * - 支持按是否在线筛选（is_online: '0'=离线, '1'=在线）
   * - 支持按用户名筛选（user_name，模糊匹配）
   * - 支持按设备组名称筛选（device_group_name，模糊匹配）
   * - 支持按操作系统筛选（os，模糊匹配）
   *
   * @param userId 当前用户ID（从JWT令牌中提取）
   * @param isAdmin 是否为管理员（从JWT令牌中提取）
   * @param query 查询参数（分页、筛选条件）
   * @returns 可访问的设备列表（分页）
   */
  @Get('peers')
  async getAccessiblePeers(
    @CurrentUser('id') userId: string,
    @Query() query: PeerQueryDto,
  ) {
    const currentUser =
      await this.rbacAuthorizationService.getCurrentUser(userId);
    return this.peerService.getAccessiblePeers(
      userId,
      query,
      currentUser.isAdmin,
    );
  }

  // ============ 管理员 API 接口 ============

  /**
   * 获取设备组列表
   * 管理员可以查看所有设备组
   *
   * @param userId 当前用户ID（从JWT令牌中提取）
   * @param query 查询参数（分页、名称过滤）
   * @returns 设备组列表（分页）
   */
  @Get('device-groups')
  @UseGuards(AdminGuard)
  async getDeviceGroups(
    @CurrentUser('id') userId: string,
    @Query() query: DeviceGroupQueryDto,
  ) {
    const currentUser =
      await this.rbacAuthorizationService.getCurrentUser(userId);
    return this.deviceGroupService.getAccessibleDeviceGroups(
      userId,
      query,
      currentUser.isAdmin,
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
    @CurrentUser('id') userId: string,
  ) {
    return this.deviceGroupService.createDeviceGroup(
      body.name,
      body.note,
      body.allowed_incomings,
      userId,
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
    @CurrentUser('id') userId: string,
  ) {
    return this.deviceGroupService.updateDeviceGroup(
      guid,
      body.name,
      body.note,
      body.allowed_incomings,
      userId,
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
  async deleteDeviceGroup(
    @Param('guid') guid: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.deviceGroupService.deleteDeviceGroup(guid, userId);
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
  async addDevicesToGroup(
    @Param('guid') guid: string,
    @Body() body: string[],
    @CurrentUser('id') userId: string,
  ) {
    return this.deviceGroupService.addDevicesToGroup(guid, body, userId);
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
    @CurrentUser('id') userId: string,
  ) {
    return this.deviceGroupService.removeDevicesFromGroup(guid, body, userId);
  }

  /**
   * 获取设备列表
   * 管理员可以查看所有设备
   *
   * @param userId 当前用户ID（从JWT令牌中提取）
   * @param query 查询参数（分页、过滤）
   * @returns 设备列表（分页）
   */
  @Get('devices')
  @RequirePermission('devices.view')
  async getDevices(
    @CurrentUser('id') userId: string,
    @Query() query: DeviceQueryDto,
  ) {
    const scope = await this.rbacAuthorizationService.getPermissionScope(
      userId,
      'devices.view',
    );
    return this.deviceGroupService.getDevices(
      userId,
      query,
      scope.global,
      scope,
    );
  }

  /**
   * 批量更新设备状态
   * 管理员可以批量启用或禁用设备
   *
   * @param dto 更新状态请求
   * @returns 操作结果
   */
  @Patch('devices/status')
  @RequirePermission('devices.status')
  async updateDeviceStatus(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateDeviceStatusDto,
  ): Promise<{ success: boolean; data: DeviceOperationResult }> {
    const result = await this.deviceGroupService.updateDeviceStatus(
      dto.guids,
      dto.status,
      userId,
    );
    return {
      success: result.failedCount === 0,
      data: result,
    };
  }

  /**
   * 更新设备属性
   * 管理员可以部分更新设备的用户、设备组、策略和备注
   * 传字符串值 -> 按名称查找并关联
   * 传 null -> 清除关联
   * 不传某字段 -> 不修改该属性
   *
   * @param guid 设备GUID
   * @param dto 更新数据
   * @returns 更新结果
   */
  @Patch('devices/:guid')
  @RequirePermission('devices.edit')
  async updateDevice(
    @Param('guid') guid: string,
    @Body() dto: UpdateDeviceDto,
    @CurrentUser('id') userId: string,
  ) {
    await this.deviceGroupService.updateDevice(guid, dto, userId);
    return { message: '设备更新成功' };
  }

  /**
   * 删除设备
   * 管理员可以删除设备
   *
   * @param guid 设备GUID
   * @returns 删除结果
   */
  @Delete('devices/:guid')
  @RequirePermission('devices.delete')
  @HttpCode(HttpStatus.OK)
  async deleteDevice(
    @Param('guid') guid: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.deviceGroupService.deleteDevice(guid, userId);
    return { message: '设备已删除' };
  }

  /**
   * 强制断开设备连接
   * 管理员可以强制断开指定设备的活跃连接
   * 断开指令将在设备下次心跳时下发给客户端执行
   *
   * @param uuid 设备UUID
   * @param dto 断开连接请求，包含需要断开的连接ID列表
   * @returns 操作结果
   */
  @Post('devices/:uuid/disconnect')
  @RequirePermission('devices.disconnect')
  @HttpCode(HttpStatus.OK)
  async disconnectDevice(
    @Param('uuid') uuid: string,
    @Body() dto: DisconnectDto,
    @CurrentUser('id') userId: string,
  ) {
    // Check the current device-group scope before inspecting connections or
    // enqueueing a disconnect command. A scoped operator must not be able to
    // act on an out-of-scope device by supplying its UUID directly.
    await this.rbacAuthorizationService.assertDeviceAccess(
      userId,
      'devices.disconnect',
      uuid,
    );

    // 验证请求断开的连接ID是否为该设备的活跃连接
    const activeConnIds =
      await this.heartbeatService.getActiveConnectionIds(uuid);
    const activeConnIdSet = new Set(activeConnIds);
    const invalidConnIds = dto.connIds.filter((id) => !activeConnIdSet.has(id));
    if (invalidConnIds.length > 0) {
      throw new BadRequestException(
        `以下连接ID不存在或不属于该设备: ${invalidConnIds.join(', ')}`,
      );
    }

    this.disconnectStoreService.addPendingDisconnects(uuid, dto.connIds);
    return {
      message: '断开指令已提交，将在设备下次心跳时下发',
      data: {
        uuid,
        pending_disconnect_count: dto.connIds.length,
      },
    };
  }
}
