import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * System setting entity
 * Generic key-value settings storage, supports grouping by category
 *
 * Example:
 * - key: 'smtp.host', value: 'smtp.example.com', category: 'smtp'
 * - key: 'smtp.port', value: '587', category: 'smtp'
 * - key: 'security.maxLoginAttempts', value: '5', category: 'security'
 */
@Entity('system_settings')
export class SystemSetting {
  /**
   * Setting key (primary key)
   * Format: {category}.{name}, e.g. smtp.host
   */
  @PrimaryColumn()
  @Index()
  key: string;

  /**
   * Setting value
   * Stored as a string; complex types are JSON serialized
   */
  @Column({ type: 'text' })
  value: string;

  /**
   * Setting category
   * Used for group management, e.g. smtp, security, notification
   */
  @Column()
  @Index()
  category: string;

  /**
   * Setting description
   * Optional, describes the purpose of the setting
   */
  @Column({ nullable: true })
  description: string;

  /**
   * Whether the value is sensitive
   * Sensitive values must be masked in API responses
   */
  @Column({ default: false })
  isSensitive: boolean;

  /**
   * Creation time
   */
  @CreateDateColumn()
  createdAt: Date;

  /**
   * Update time
   */
  @UpdateDateColumn()
  updatedAt: Date;
}
