import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('strategies')
export class Strategy {
  @PrimaryColumn()
  guid: string;

  @Column()
  @Index({ unique: true })
  name: string;

  @Column({ type: 'text', nullable: true })
  note: string;

  @Column({ type: 'text', nullable: true })
  configOptions: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  rustdeskVersion: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
