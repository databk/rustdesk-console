import { IsArray, ArrayNotEmpty, IsNumber } from 'class-validator';

/**
 * 断开连接DTO
 * 用于管理员强制断开指定设备的连接
 */
export class DisconnectDto {
  /**
   * 需要强制断开的连接ID列表
   */
  @IsArray()
  @ArrayNotEmpty()
  @IsNumber({}, { each: true })
  connIds: number[];
}
