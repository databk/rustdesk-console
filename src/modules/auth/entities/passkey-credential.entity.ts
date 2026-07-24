import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Passkey 凭证实体
 * 存储用户绑定的 WebAuthn 凭证信息，用于无密码登录和双因素认证
 */
@Entity('passkey_credentials')
export class PasskeyCredential {
  /**
   * 凭证唯一标识符
   * UUID格式
   */
  @PrimaryColumn()
  guid: string;

  /**
   * 所属用户唯一标识符
   * 关联到 users 表的 guid 字段
   */
  @Column()
  @Index()
  userGuid: string;

  /**
   * WebAuthn 凭证 ID
   * base64url 编码，由认证器生成，全局唯一
   * 登录时通过此字段反查用户，实现无密码登录
   */
  @Column({ type: 'varchar', unique: true })
  credentialId: string;

  /**
   * 凭证公钥
   * base64url 编码，用于验证认证器签名
   */
  @Column({ type: 'varchar' })
  credentialPublicKey: string;

  /**
   * 签名计数器
   * 认证器每次认证自增，服务端校验递增以检测凭证克隆
   */
  @Column({ default: 0 })
  counter: number;

  /**
   * 传输方式
   * JSON 数组，如 ["internal", "hybrid"]
   * 浏览器据此选择如何唤醒认证器
   */
  @Column({ type: 'varchar', nullable: true })
  transports: string | null;

  /**
   * 设备类型
   * 'singleDevice' - 单设备凭证（如安全密钥）
   * 'multiDevice' - 多设备凭证（如 Touch ID、Windows Hello，支持云端同步）
   */
  @Column({ type: 'varchar', nullable: true })
  deviceType: string;

  /**
   * 是否已备份
   * 多设备凭证通常已备份到云端（iCloud/Google）
   */
  @Column({ default: false })
  backedUp: boolean;

  /**
   * 用户自定义凭证名称
   * 用于在管理界面中识别不同的凭证
   */
  @Column({ type: 'varchar', nullable: true })
  name: string | null;

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
