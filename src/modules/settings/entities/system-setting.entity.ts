import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 系统设置实体
 * 通用的 key-value 设置存储，支持按 category 分组
 *
 * 示例：
 * - key: 'smtp.host', value: 'smtp.example.com', category: 'smtp'
 * - key: 'smtp.port', value: '587', category: 'smtp'
 * - key: 'security.maxLoginAttempts', value: '5', category: 'security'
 */
@Entity('system_settings')
export class SystemSetting {
  /**
   * 设置项键名（主键）
   * 格式：{category}.{name}，如 smtp.host
   */
  @PrimaryColumn()
  @Index()
  key: string;

  /**
   * 设置项值
   * 存储为字符串，复杂类型使用 JSON 序列化
   */
  @Column({ type: 'text' })
  value: string;

  /**
   * 设置分类
   * 用于分组管理，如 smtp、security、notification
   */
  @Column()
  @Index()
  category: string;

  /**
   * 设置项描述
   * 可选，用于说明设置项用途
   */
  @Column({ nullable: true })
  description: string;

  /**
   * 是否为敏感值
   * 敏感值在 API 返回时需要脱敏
   */
  @Column({ default: false })
  isSensitive: boolean;

  /**
   * 创建时间
   */
  @CreateDateColumn()
  createdAt: Date;

  /**
   * 更新时间
   */
  @UpdateDateColumn()
  updatedAt: Date;
}
