import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

/**
 * 活跃连接实体
 * 存储客户端心跳上报的当前活跃连接
 */
@Entity('active_connections')
export class ActiveConnection {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * 连接ID
   * 客户端上报的连接唯一标识
   */
  @Column({ type: 'int' })
  @Index()
  connId: number;

  /**
   * 设备UUID
   * 关联到 peers 表的 uuid 字段
   */
  @Column({ type: 'varchar', length: 36 })
  @Index()
  deviceUuid: string;

  /**
   * 关联的设备实体
   */
  @ManyToOne('Peer', undefined, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceUuid' })
  device: any;

  @CreateDateColumn()
  createdAt: Date;
}
