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
  ParseArrayPipe,
} from '@nestjs/common';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { ConsoleAuditAction } from '../../rbac/decorators/console-audit-action.decorator';
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
  @ConsoleAuditAction('oidc_provider.create', {
    targetGuidResponseField: 'guid',
  })
  @HttpCode(HttpStatus.OK)
  async create(@Body() dto: CreateOidcProviderDto) {
    return this.oidcAdminService.create(dto);
  }

  @Patch('sort')
  @ConsoleAuditAction('oidc_provider.sort', { targetGuidParam: false })
  @HttpCode(HttpStatus.OK)
  async sort(
    @Body(new ParseArrayPipe({ items: String, disableErrorMessages: false }))
    guids: string[],
  ) {
    await this.oidcAdminService.sort(guids);
    return { message: 'OIDC provider order updated' };
  }

  @Patch(':guid')
  @ConsoleAuditAction('oidc_provider.update')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('guid') guid: string,
    @Body() dto: UpdateOidcProviderDto,
  ) {
    return this.oidcAdminService.update(guid, dto);
  }

  @Delete(':guid')
  @ConsoleAuditAction('oidc_provider.delete')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('guid') guid: string) {
    await this.oidcAdminService.remove(guid);
    return { message: 'OIDC provider deleted' };
  }

  @Patch(':guid/toggle')
  @ConsoleAuditAction('oidc_provider.toggle')
  @HttpCode(HttpStatus.OK)
  async toggle(
    @Param('guid') guid: string,
    @Body() dto: ToggleOidcProviderDto,
  ) {
    return this.oidcAdminService.toggle(guid, dto.enabled);
  }

  @Post(':guid/test')
  @ConsoleAuditAction('oidc_provider.test')
  @HttpCode(HttpStatus.OK)
  async testConnection(@Param('guid') guid: string) {
    return this.oidcAdminService.testConnection(guid);
  }
}
