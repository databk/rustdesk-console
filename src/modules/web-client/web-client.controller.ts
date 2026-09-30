import { Controller, Get, Header } from '@nestjs/common';
import { WebClientService } from './web-client.service';

// 继承全局 JWT 认证；手动 ID 入口不要求设备列表或管理员权限。
@Controller('web-client')
export class WebClientController {
  constructor(private readonly service: WebClientService) {}

  @Get('config')
  @Header('Cache-Control', 'no-store')
  getConfiguration() {
    return this.service.getConfiguration();
  }
}
