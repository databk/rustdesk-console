import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomClientController } from './custom-client.controller';
import { CustomClientService } from './custom-client.service';
import { CustomClientBuild } from './entities/custom-client-build.entity';
import { CustomClientSettingsService } from './services/custom-client-settings.service';
import { CustomClientSigningService } from './services/custom-client-signing.service';
import { CustomClientLogoService } from './services/custom-client-logo.service';
import { BuildStatusSyncService } from './services/build-status-sync.service';
import { SystemSetting } from '../settings/entities/system-setting.entity';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CustomClientBuild, SystemSetting]),
    SettingsModule,
  ],
  controllers: [CustomClientController],
  providers: [
    CustomClientService,
    CustomClientSettingsService,
    CustomClientSigningService,
    CustomClientLogoService,
    BuildStatusSyncService,
  ],
  exports: [CustomClientService, CustomClientSettingsService],
})
export class CustomClientModule {}
