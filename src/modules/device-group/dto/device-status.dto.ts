import { IsArray, IsString, IsEnum, ArrayMinSize } from 'class-validator';

export enum DeviceStatus {
  ENABLED = 'enabled',
  DISABLED = 'disabled',
}

export class UpdateDeviceStatusDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one device GUID is required' })
  @IsString({ each: true, message: 'Device GUID must be a string' })
  guids: string[];

  @IsEnum(DeviceStatus, { message: 'Status must be "enabled" or "disabled"' })
  status: DeviceStatus;
}

export interface DeviceOperationFailure {
  guid: string;
  reason: string;
}

export interface DeviceOperationResult {
  succeeded: string[];
  failed: DeviceOperationFailure[];
  total: number;
  succeededCount: number;
  failedCount: number;
}
