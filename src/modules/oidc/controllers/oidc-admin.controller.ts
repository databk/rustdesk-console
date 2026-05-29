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
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { OidcAdminService } from '../services/oidc-admin.service';
import {
  CreateOidcProviderDto,
  UpdateOidcProviderDto,
  ToggleOidcProviderDto,
  OidcProviderQueryDto,
} from '../dto/oidc-provider.dto';

@Controller('oidc-providers')
@UseGuards(AdminGuard)
export class OidcAdminController {
  constructor(private readonly oidcAdminService: OidcAdminService) {}

  @Get()
  async findAll(@Query() query: OidcProviderQueryDto) {
    return this.oidcAdminService.findAll(query);
  }

  @Get(':guid')
  async findOne(@Param('guid') guid: string) {
    return this.oidcAdminService.findOne(guid);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async create(@Body() dto: CreateOidcProviderDto) {
    return this.oidcAdminService.create(dto);
  }

  @Patch(':guid')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('guid') guid: string,
    @Body() dto: UpdateOidcProviderDto,
  ) {
    return this.oidcAdminService.update(guid, dto);
  }

  @Delete(':guid')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('guid') guid: string) {
    await this.oidcAdminService.remove(guid);
    return { message: 'OIDC 提供商已删除' };
  }

  @Patch(':guid/toggle')
  @HttpCode(HttpStatus.OK)
  async toggle(
    @Param('guid') guid: string,
    @Body() dto: ToggleOidcProviderDto,
  ) {
    return this.oidcAdminService.toggle(guid, dto.enabled);
  }

  @Post(':guid/test')
  @HttpCode(HttpStatus.OK)
  async testConnection(@Param('guid') guid: string) {
    return this.oidcAdminService.testConnection(guid);
  }
}
