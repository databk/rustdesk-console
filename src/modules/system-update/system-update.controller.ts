import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CreateSystemUpdateJobDto,
  CreateSystemUpdatePlanDto,
} from './dto/system-update.dto';
import { SystemUpdateService } from './system-update.service';
@Controller('system-update')
@UseGuards(AdminGuard)
export class SystemUpdateController {
  constructor(private readonly updates: SystemUpdateService) {}
  @Get('capabilities') capabilities() {
    return this.updates.capabilities();
  }
  @Post('plans')
  @HttpCode(200)
  plan(
    @Body() body: CreateSystemUpdatePlanDto,
    @CurrentUser('id') actorId: string,
  ) {
    if (!body || Array.isArray(body) || Object.keys(body).length)
      throw new BadRequestException(
        'The update plan request must be an empty object.',
      );
    return this.updates.plan(actorId);
  }
  @Post('jobs')
  @HttpCode(202)
  create(
    @Body() body: CreateSystemUpdateJobDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.updates.create(body, actorId);
  }
  @Get('jobs/current') current() {
    return this.updates.current();
  }
  @Get('jobs/:id') job(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.updates.job(id);
  }
}
