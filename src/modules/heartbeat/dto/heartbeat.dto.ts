import {
  IsString,
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsArray,
} from 'class-validator';

/**
 * HeartbeatDto
 * Used for reporting device heartbeat data
 */
export class HeartbeatDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  uuid: string;

  @IsNumber()
  @IsNotEmpty()
  ver: number;

  @IsNumber()
  @IsNotEmpty()
  modified_at: number;

  /**
   * List of currently active connection IDs
   * The client reports the active connections it currently holds; the server uses this to maintain connection state
   */
  @IsOptional()
  @IsArray()
  conns?: number[];
}
