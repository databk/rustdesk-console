import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressBookRule } from '../address-book/entities/address-book-rule.entity';
import { User } from '../user/entities/user.entity';
import { UserGroup } from './entities/user-group.entity';
import { UserGroupController } from './user-group.controller';
import { UserGroupService } from './user-group.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserGroup, User, AddressBookRule])],
  controllers: [UserGroupController],
  providers: [UserGroupService],
  exports: [UserGroupService],
})
export class UserGroupModule {}
