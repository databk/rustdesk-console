import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsArray,
  IsBoolean,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Data transfer object for adding a device to the address book
 */
export class AddPeerDto {
  /**
   * Device ID
   * Unique identifier of the RustDesk client, usually numeric
   * Used to join the sysinfos table for device details (such as username, hostname, operating system)
   */
  @IsString()
  @IsNotEmpty()
  id: string;

  /**
   * Connection hash
   * Secure hash used to verify the connection (used by personal address books)
   */
  @IsOptional()
  @IsString()
  hash?: string;

  /**
   * Connection password
   * Connection password of the device (used by shared address books)
   */
  @IsOptional()
  @IsString()
  password?: string;

  /**
   * Device alias
   * User-defined display name of the device
   */
  @IsOptional()
  @IsString()
  alias?: string;

  /**
   * Remarks
   * Detailed description or remarks for the device
   */
  @IsOptional()
  @IsString()
  note?: string;

  /**
   * List of tag names
   * Array of tag names associated with the device
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  // The following fields are extra fields sent by the client and are not processed for now

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  hostname?: string;

  @IsOptional()
  @IsString()
  platform?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  forceAlwaysRelay?: boolean;

  @IsOptional()
  @IsString()
  rdpPort?: string;

  @IsOptional()
  @IsString()
  rdpUsername?: string;

  @IsOptional()
  @IsString()
  loginName?: string;

  @IsOptional()
  @IsString()
  device_group_name?: string;

  @IsOptional()
  @IsBoolean()
  same_server?: boolean;
}

/**
 * Data transfer object for updating device information
 */
export class UpdatePeerDto {
  /**
   * Device ID
   * Unique identifier of the RustDesk client
   */
  @IsString()
  @IsNotEmpty()
  id: string;

  /**
   * Connection hash
   * Secure hash used to verify the connection (used by personal address books)
   */
  @IsOptional()
  @IsString()
  hash?: string;

  /**
   * Connection password
   * Connection password of the device (used by shared address books)
   */
  @IsOptional()
  @IsString()
  password?: string;

  /**
   * Device alias
   * User-defined display name of the device
   */
  @IsOptional()
  @IsString()
  alias?: string;

  /**
   * Remarks
   * Detailed description or remarks for the device
   */
  @IsOptional()
  @IsString()
  note?: string;

  /**
   * List of tag names
   * Array of tag names associated with the device
   * On update, replaces the existing tag associations
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /**
   * Device login username
   * Used to sync device information
   */
  @IsOptional()
  @IsString()
  username?: string;

  /**
   * Device hostname
   * Used to sync device information
   */
  @IsOptional()
  @IsString()
  hostname?: string;

  /**
   * Operating system
   * Used to sync device information
   */
  @IsOptional()
  @IsString()
  platform?: string;
}
