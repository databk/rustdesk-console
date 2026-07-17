import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';

@Entity('user_groups')
@Index('UQ_user_groups_single_default', ['isDefault'], {
  unique: true,
  where: '"isDefault" = 1',
})
export class UserGroup {
  @PrimaryColumn()
  guid: string;

  @Column()
  name: string;

  @Column({ unique: true })
  @Index()
  normalizedName: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ default: false })
  isDefault: boolean;

  @OneToMany(() => User, (user) => user.userGroup)
  users: User[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
