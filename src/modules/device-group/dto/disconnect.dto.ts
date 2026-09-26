import { IsArray, ArrayNotEmpty, IsNumber } from 'class-validator';

/**
 * Disconnect DTO
 * Used by administrators to forcibly disconnect connections of specified devices
 */
export class DisconnectDto {
  /**
   * List of connection IDs to forcibly disconnect
   */
  @IsArray()
  @ArrayNotEmpty()
  @IsNumber({}, { each: true })
  connIds: number[];
}
