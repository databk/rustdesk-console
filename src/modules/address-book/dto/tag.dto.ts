import { IsString, IsNumber, IsOptional, IsNotEmpty } from 'class-validator';

/**
 * 添加标签的数据传输对象
 */
export class AddTagDto {
  /**
   * 标签名称
   * 用于显示和区分不同的标签
   * 在同一地址簿内标签名不能重复
   */
  @IsString()
  @IsNotEmpty()
  name: string;

  /**
   * 标签颜色
   * ARGB整数值，用于前端显示
   * 例如: 4280391411
   * 默认值: 0
   */
  @IsOptional()
  @IsNumber()
  color?: number;
}

/**
 * 更新标签颜色的数据传输对象
 */
export class UpdateTagDto {
  /**
   * 标签名称
   * 用于定位要更新的标签
   */
  @IsString()
  @IsNotEmpty()
  name: string;

  /**
   * 标签颜色
   * ARGB整数值，用于前端显示
   * 例如: 4280391411
   */
  @IsNumber()
  color: number;
}

/**
 * 重命名标签的数据传输对象
 */
export class RenameTagDto {
  /**
   * 旧标签名称
   * 用于定位要重命名的标签
   */
  @IsString()
  @IsNotEmpty()
  old: string;

  /**
   * 新标签名称
   * 重命名后的标签名，在同一地址簿内不能与现有标签名重复
   */
  @IsString()
  @IsNotEmpty()
  new: string;
}
