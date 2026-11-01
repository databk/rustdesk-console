import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomClientController } from './custom-client.controller';
import { CustomClientService } from './custom-client.service';
import { CustomClientBuild } from './entities/custom-client-build.entity';
import { CustomClientSettingsService } from './services/custom-client-settings.service';
import { SystemSetting } from '../settings/entities/system-setting.entity';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CustomClientBuild, SystemSetting]),
    SettingsModule,
  ],
  controllers: [CustomClientController],
  providers: [CustomClientService, CustomClientSettingsService],
  exports: [CustomClientService, CustomClientSettingsService],
})
export class CustomClientModule {}
