import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * SMTP 配置实体
 * 管理 SMTP 邮件服务器的连接配置
 */
@Entity('smtp_configs')
export class SmtpConfig {
  /**
   * 配置唯一标识符
   */
  @PrimaryColumn()
  guid: string;

  /**
   * SMTP 服务器地址
   */
  @Column()
  host: string;

  /**
   * SMTP 服务器端口
   */
  @Column({ default: 587 })
  port: number;

  /**
   * 是否使用 SSL/TLS
   * true 对应端口 465，false 对应其他端口
   */
  @Column({ default: false })
  secure: boolean;

  /**
   * 认证用户名
   */
  @Column()
  user: string;

  /**
   * 认证密码
   * select: false 查询时默认不返回
   */
  @Column({ select: false })
  pass: string;

  /**
   * 发件人地址
   * 格式如: '"No Reply" <noreply@example.com>'
   */
  @Column()
  from: string;

  /**
   * 是否启用
   */
  @Column({ default: true })
  enabled: boolean;

  /**
   * 是否为当前生效的配置
   * 全局仅一条记录为 true
   */
  @Column({ default: true })
  isDefault: boolean;

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
