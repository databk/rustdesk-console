import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { StrategyService } from './strategy.service';
import {
  CreateStrategyDto,
  UpdateStrategyDto,
  AssignStrategyDto,
  StrategyQueryDto,
  AssignmentQueryDto,
} from './dto/strategy.dto';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller()
export class StrategyController {
  constructor(private readonly strategyService: StrategyService) {}

  @Get('strategies')
  @RequirePermission('strategies.view')
  async getStrategies(@Query() query: StrategyQueryDto) {
    return this.strategyService.getStrategies(query);
  }

  @Get('strategies/:guid')
  @RequirePermission('strategies.view')
  async getStrategy(@Param('guid') guid: string) {
    return this.strategyService.getStrategy(guid);
  }

  @Get('strategies/:guid/assignments')
  @RequirePermission('strategies.view')
  async getStrategyAssignments(
    @Param('guid') guid: string,
    @Query() query: AssignmentQueryDto,
  ) {
    return this.strategyService.getStrategyAssignments(guid, query);
  }

  @Post('strategies')
  @RequirePermission('strategies.create')
  @HttpCode(HttpStatus.OK)
  async createStrategy(@Body() dto: CreateStrategyDto) {
    return this.strategyService.createStrategy(dto);
  }

  @Patch('strategies/:guid')
  @RequirePermission('strategies.edit')
  @HttpCode(HttpStatus.OK)
  async updateStrategy(
    @Param('guid') guid: string,
    @Body() dto: UpdateStrategyDto,
  ) {
    return this.strategyService.updateStrategy(guid, dto);
  }

  @Delete('strategies/:guid')
  @RequirePermission('strategies.delete')
  @HttpCode(HttpStatus.OK)
  async deleteStrategy(@Param('guid') guid: string) {
    await this.strategyService.deleteStrategy(guid);
    return { message: '策略删除成功' };
  }

  @Post('strategies/:guid/assign')
  @RequirePermission('strategies.assign')
  @HttpCode(HttpStatus.OK)
  async assignStrategy(
    @Param('guid') guid: string,
    @Body() dto: AssignStrategyDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.strategyService.assignStrategy(
      guid,
      dto.target_type,
      dto.target_guids,
      userId,
    );
  }

  @Post('strategies/:guid/unassign')
  @RequirePermission('strategies.assign')
  @HttpCode(HttpStatus.OK)
  async unassignStrategy(
    @Param('guid') strategyGuid: string,
    @Body() dto: AssignStrategyDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.strategyService.unassignStrategy(
      strategyGuid,
      dto.target_type,
      dto.target_guids,
      userId,
    );
  }
}
