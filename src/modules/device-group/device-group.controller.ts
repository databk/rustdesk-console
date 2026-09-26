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
 * Device group controller
 * Manages device-group-related client endpoints and provides queries for accessible resources
 *
 * Number of endpoints: 3
 * - GET /api/device-group/accessible - Get the list of accessible device groups
 * - GET /api/peers - Get the list of accessible devices
 * - GET /api/users - Get the list of accessible users
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

  // ============ Client API endpoints ============

  /**
   * Get the list of device groups accessible to the current user
   * Gets the accessible device group list based on user permissions; administrators can see all device groups
   *
   * Features:
   * - Regular users can only see device groups they have permission to access
   * - Administrators can see all device groups
   * - Supports paginated queries
   * - Supports searching by name
   *
   * @param userId Current user ID (extracted from the JWT token)
   * @param isAdmin Whether the user is an administrator (extracted from the JWT token)
   * @param query Query parameters (pagination, search, etc.)
   * @returns Accessible device group list (paginated)
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
   * Get the list of devices accessible to the current user
   * Gets the accessible device list based on user permissions; administrators can see all devices
   *
   * Features:
   * - Regular users can only see devices they have permission to access
   * - Administrators can see all devices
   * - Supports paginated queries (current, pageSize)
   * - Supports filtering by device ID (id, fuzzy match)
   * - Supports filtering by device status (status: '0' = disabled, '1' = normal)
   * - Supports filtering by online status (is_online: '0' = offline, '1' = online)
   * - Supports filtering by user name (user_name, fuzzy match)
   * - Supports filtering by device group name (device_group_name, fuzzy match)
   * - Supports filtering by operating system (os, fuzzy match)
   *
   * @param userId Current user ID (extracted from the JWT token)
   * @param isAdmin Whether the user is an administrator (extracted from the JWT token)
   * @param query Query parameters (pagination, filter conditions)
   * @returns Accessible device list (paginated)
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

  // ============ Administrator API endpoints ============

  /** Get the full device group management list. */
  @Get('device-groups')
  @UseGuards(AdminGuard)
  async getDeviceGroups(
    @CurrentUser('id') userId: string,
    @Query() query: DeviceGroupQueryDto,
  ) {
    return this.deviceGroupService.getAccessibleDeviceGroups(
      userId,
      query,
      true,
    );
  }

  /** Get device group candidates within the current strategy assignment scope. */
  @Get('device-groups/strategy-targets')
  @RequirePermission('strategies.assign')
  async getStrategyTargetDeviceGroups(
    @CurrentUser('id') userId: string,
    @Query() query: DeviceGroupQueryDto,
  ) {
    const scope = await this.rbacAuthorizationService.getPermissionScope(
      userId,
      'strategies.assign',
    );
    return this.deviceGroupService.getAccessibleDeviceGroups(
      userId,
      query,
      scope.global,
      scope,
    );
  }

  /**
   * Create device group
   * Administrators can create new device groups
   *
   * @param body Device group data
   * @returns Creation result
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
   * Update device group
   * Administrators can update device group information
   *
   * @param guid Device group GUID
   * @param body Update data
   * @returns Update result
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
   * Delete device group
   * Administrators can delete device groups
   *
   * @param guid Device group GUID
   * @returns Deletion result
   */
  @Delete('device-groups/:guid')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async deleteDeviceGroup(
    @Param('guid') guid: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.deviceGroupService.deleteDeviceGroup(guid, userId);
    return { message: 'Device group deleted successfully' };
  }

  /**
   * Add devices to device group
   * Administrators can add devices to a device group
   *
   * @param guid Device group GUID
   * @param body List of device IDs
   * @returns Addition result
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
   * Remove devices from device group
   * Administrators can remove devices from a device group
   *
   * @param guid Device group GUID
   * @param body List of device IDs
   * @returns Removal result
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
   * Get device list
   * Administrators can view all devices
   *
   * @param userId Current user ID (extracted from the JWT token)
   * @param query Query parameters (pagination, filtering)
   * @returns Device list (paginated)
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
   * Batch update device status
   * Administrators can enable or disable devices in batch
   *
   * @param dto Status update request
   * @returns Operation result
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
   * Update device properties
   * Administrators can partially update the device's user, device group, strategy and remarks
   * Pass a string value -> look up by name and associate
   * Pass null -> clear the association
   * Omit a field -> that property is left unchanged
   *
   * @param guid Device GUID
   * @param dto Update data
   * @returns Update result
   */
  @Patch('devices/:guid')
  @RequirePermission('devices.edit')
  async updateDevice(
    @Param('guid') guid: string,
    @Body() dto: UpdateDeviceDto,
    @CurrentUser('id') userId: string,
  ) {
    await this.deviceGroupService.updateDevice(guid, dto, userId);
    return { message: 'Device updated successfully' };
  }

  /**
   * Delete device
   * Administrators can delete devices
   *
   * @param guid Device GUID
   * @returns Deletion result
   */
  @Delete('devices/:guid')
  @RequirePermission('devices.delete')
  @HttpCode(HttpStatus.OK)
  async deleteDevice(
    @Param('guid') guid: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.deviceGroupService.deleteDevice(guid, userId);
    return { message: 'Device deleted' };
  }

  /**
   * Forcibly disconnect device connections
   * Administrators can forcibly disconnect the active connections of a specified device
   * The disconnect command is delivered to the client for execution at the device's next heartbeat
   *
   * @param uuid Device UUID
   * @param dto Disconnect request, including the list of connection IDs to disconnect
   * @returns Operation result
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

    // Verify that the connection IDs requested to be disconnected are active connections of this device
    const activeConnIds =
      await this.heartbeatService.getActiveConnectionIds(uuid);
    const activeConnIdSet = new Set(activeConnIds);
    const invalidConnIds = dto.connIds.filter((id) => !activeConnIdSet.has(id));
    if (invalidConnIds.length > 0) {
      throw new BadRequestException(
        `The following connection IDs do not exist or do not belong to this device: ${invalidConnIds.join(', ')}`,
      );
    }

    // The device may have been moved while the active connections were read.
    // Recheck immediately before the synchronous enqueue operation.
    await this.rbacAuthorizationService.assertDeviceAccess(
      userId,
      'devices.disconnect',
      uuid,
    );
    this.disconnectStoreService.addPendingDisconnects(uuid, dto.connIds);
    return {
      message:
        'Disconnect command submitted; it will be delivered at the next device heartbeat',
      data: {
        uuid,
        pending_disconnect_count: dto.connIds.length,
      },
    };
  }
}
