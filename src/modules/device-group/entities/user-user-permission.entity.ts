import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';

/**
 * User-to-user permission entity
 * Manages a user's access permission to other users' devices
 * Uses a composite primary key (userGuid, targetUserGuid)
 */
@Entity('user_user_permissions')
export class UserUserPermission {
  /**
   * Authorized user unique identifier
   * The user who holds the access permission
   */
  @PrimaryColumn()
  @Index()
  userGuid: string;

  /**
   * Target user unique identifier
   * The user being granted access (whose devices can be accessed)
   */
  @PrimaryColumn()
  @Index()
  targetUserGuid: string;

  /**
   * Associated authorized user entity
   * Many-to-one relation to User
   */
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userGuid' })
  user: User;

  /**
   * Associated target user entity
   * Many-to-one relation to User
   */
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'targetUserGuid' })
  targetUser: User;

  /**
   * Creation time
   */
  @CreateDateColumn()
  createdAt: Date;
}
