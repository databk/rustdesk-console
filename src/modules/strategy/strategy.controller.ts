import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
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
import { AdminGuard } from '../../common/guards/admin.guard';

@Controller()
export class StrategyController {
  constructor(private readonly strategyService: StrategyService) {}

  @Get('strategies')
  @UseGuards(AdminGuard)
  async getStrategies(@Query() query: StrategyQueryDto) {
    return this.strategyService.getStrategies(query);
  }

  @Get('strategies/:guid')
  @UseGuards(AdminGuard)
  async getStrategy(@Param('guid') guid: string) {
    return this.strategyService.getStrategy(guid);
  }

  @Get('strategies/:guid/assignments')
  @UseGuards(AdminGuard)
  async getStrategyAssignments(
    @Param('guid') guid: string,
    @Query() query: AssignmentQueryDto,
  ) {
    return this.strategyService.getStrategyAssignments(guid, query);
  }

  @Post('strategies')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async createStrategy(@Body() dto: CreateStrategyDto) {
    return this.strategyService.createStrategy(dto);
  }

  @Patch('strategies/:guid')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async updateStrategy(
    @Param('guid') guid: string,
    @Body() dto: UpdateStrategyDto,
  ) {
    return this.strategyService.updateStrategy(guid, dto);
  }

  @Delete('strategies/:guid')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async deleteStrategy(@Param('guid') guid: string) {
    await this.strategyService.deleteStrategy(guid);
    return { message: '策略删除成功' };
  }

  @Post('strategies/:guid/assign')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async assignStrategy(
    @Param('guid') guid: string,
    @Body() dto: AssignStrategyDto,
  ) {
    return this.strategyService.assignStrategy(
      guid,
      dto.target_type,
      dto.target_guids,
    );
  }

  @Post('strategies/:guid/unassign')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async unassignStrategy(@Body() dto: AssignStrategyDto) {
    return this.strategyService.unassignStrategy(
      dto.target_type,
      dto.target_guids,
    );
  }
}
