import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { IndexOptions } from 'typeorm';
import { getDbType } from '../../../common/utils/data-dir.util';
import { User } from '../../user/entities/user.entity';

@Entity('user_groups')
@Index('UQ_user_groups_single_default', ['isDefault'], {
  unique: true,
  where: '"isDefault" = 1',
  // MySQL needs a functional index, installed by a migration.
  synchronize: getDbType() !== 'mysql',
} as IndexOptions & { synchronize: boolean })
export class UserGroup {
  @PrimaryColumn()
  guid: string;

  @Column()
  name: string;

  @Column()
  @Index({ unique: true })
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
