import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OidcController } from './controllers/oidc.controller';
import { OidcAdminController } from './controllers/oidc-admin.controller';
import { OidcService } from './services/oidc.service';
import { OidcAdminService } from './services/oidc-admin.service';
import { OidcAuthStateCleanupService } from './services/oidc-auth-state-cleanup.service';
import { OidcProvider } from './entities/oidc-provider.entity';
import { OidcAuthState } from './entities/oidc-auth-state.entity';
import { User } from '../user/entities/user.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OidcProvider, OidcAuthState, User]),
    AuthModule,
  ],
  controllers: [OidcController, OidcAdminController],
  providers: [OidcService, OidcAdminService, OidcAuthStateCleanupService],
  exports: [OidcService],
})
export class OidcModule {}
