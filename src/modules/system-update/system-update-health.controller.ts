import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { readBuildInfo } from '../../updater/build-info';
@Controller('system-update')
export class SystemUpdateHealthController {
  @Public()
  @Get('health')
  health() {
    return { component: 'backend', ...readBuildInfo(), maintenanceProtocol: 1 };
  }
}
