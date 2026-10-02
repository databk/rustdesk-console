import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WebClientController } from './web-client.controller';
import { WebClientService } from './web-client.service';

@Module({
  imports: [ConfigModule],
  controllers: [WebClientController],
  providers: [WebClientService],
})
export class WebClientModule {}
