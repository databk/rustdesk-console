import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('strategies')
export class Strategy {
  @PrimaryColumn()
  guid: string;

  @Column({ unique: true })
  name: string;

  @Column({ type: 'text', nullable: true })
  note: string;

  @Column({ type: 'text', nullable: true })
  configOptions: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
