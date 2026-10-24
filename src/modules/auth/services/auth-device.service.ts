import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Peer } from '../../../common/entities';
import { DeviceInfoDto } from '../dto/auth.dto';
import {
  resolveDeviceUuid,
  cloneIsolationEnabled,
} from '../../../common/utils/device-identity.util';

@Injectable()
/**
 * AuthDeviceService
 * Sub-service responsible for device binding
 *
 * Relationship to the main service:
 * AuthService delegates device-related operations to it
 *
 * Call context:
 * Includes device binding, unbinding, and status management
 */
export class AuthDeviceService {
  private readonly logger = new Logger(AuthDeviceService.name);

  constructor(
    @InjectRepository(Peer)
    private peerRepository: Repository<Peer>,
  ) {}

  /**
   * Create or update the device record
   * Binds the device to the user account to track the user's login devices
   *
   * @param userGuid user GUID
   * @param deviceId Device ID (optional)
   * @param deviceUuid Device UUID
   * @param deviceInfo Device info (optional)
   */
  async createOrUpdateDevice(
    userGuid: string,
    deviceId?: string,
    deviceUuid?: string,
    _deviceInfo?: DeviceInfoDto,
  ): Promise<void> {
    if (!deviceUuid) return;
    if (cloneIsolationEnabled() && !deviceId) return;
    if (deviceId) {
      deviceUuid = await resolveDeviceUuid(
        this.peerRepository,
        deviceUuid,
        deviceId,
      );
    }

    // Look up the peer record
    const peer = await this.peerRepository.findOne({
      where: { uuid: deviceUuid },
    });

    if (peer) {
      // Update the peer's userGuid to bind the device to the user
      await this.peerRepository.update(
        { uuid: deviceUuid },
        { userGuid: userGuid },
      );
      this.logger.log(`Device ${deviceUuid} bound to user ${userGuid}`);
    }
    // If the peer does not exist, the device is created automatically on heartbeat
  }

  /**
   * Unbind the device from the user
   * Called on user logout to unlink the device from the user
   *
   * Security measure: prevents the device from remaining linked to the user after logout
   *
   * @param userGuid user GUID
   * @param deviceUuid Device UUID
   */
  async unbindDevice(
    userGuid: string,
    deviceUuid: string,
    deviceId?: string,
  ): Promise<void> {
    if (cloneIsolationEnabled() && !deviceId) return;
    if (deviceId) {
      deviceUuid = await resolveDeviceUuid(
        this.peerRepository,
        deviceUuid,
        deviceId,
      );
    }
    const peer = await this.peerRepository.findOne({
      where: { uuid: deviceUuid, userGuid },
    });

    if (peer) {
      await this.peerRepository.update(
        { uuid: deviceUuid },
        { userGuid: null },
      );
      this.logger.log(
        `User ${userGuid} logged out; unbound device ${deviceUuid}`,
      );
    }
  }
}
