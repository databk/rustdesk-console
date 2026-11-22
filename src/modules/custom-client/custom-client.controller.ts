import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Res,
  Req,
  HttpCode,
  HttpStatus,
  NotFoundException,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { createReadStream, existsSync, statSync } from 'fs';
import { basename } from 'path';
import { CustomClientService } from './custom-client.service';
import { CustomClientSettingsService } from './services/custom-client-settings.service';
import { CustomClientLogoService } from './services/custom-client-logo.service';
import { SubmitBuildDto, UploadFilesDto } from './dto/custom-client-build.dto';
import { UpdateCustomClientSettingsDto } from './dto/custom-client-settings.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ConsoleAuditAction } from '../rbac/decorators/console-audit-action.decorator';

@Controller('custom-client')
export class CustomClientController {
  constructor(
    private readonly customClientService: CustomClientService,
    private readonly settingsService: CustomClientSettingsService,
    private readonly logoService: CustomClientLogoService,
  ) {}

  @Post('builds')
  @ConsoleAuditAction('custom_client.build.create', {
    targetGuidParam: false,
    targetGuidResponseField: 'uuid',
  })
  @HttpCode(HttpStatus.CREATED)
  async createBuild(
    @CurrentUser('id') userGuid: string,
    @Body() dto: SubmitBuildDto,
  ) {
    return this.customClientService.submitBuild(userGuid, dto);
  }

  @Get('rustdesk-releases')
  @UseGuards(AdminGuard)
  async listRustdeskReleases() {
    return this.customClientService.listRustdeskReleases();
  }

  @Get('builds')
  async listBuilds(@CurrentUser('id') userGuid: string) {
    return this.customClientService.listBuilds(userGuid);
  }

  @Delete('builds/:uuid')
  @ConsoleAuditAction('custom_client.build.delete', { targetGuidParam: 'uuid' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBuild(
    @CurrentUser('id') userGuid: string,
    @Param('uuid') uuid: string,
  ) {
    await this.customClientService.deleteBuild(userGuid, uuid);
  }

  @Post('builds/:uuid/cancel')
  @ConsoleAuditAction('custom_client.build.cancel', { targetGuidParam: 'uuid' })
  @HttpCode(HttpStatus.OK)
  async cancelBuild(
    @CurrentUser('id') userGuid: string,
    @Param('uuid') uuid: string,
  ) {
    return this.customClientService.cancelBuild(userGuid, uuid);
  }

  @Get('builds/:uuid/files')
  async listBuildFiles(
    @CurrentUser('id') userGuid: string,
    @Param('uuid') uuid: string,
  ) {
    return this.customClientService.listBuildFiles(uuid, userGuid);
  }

  @Get('builds/:uuid/progress')
  async getBuildProgress(
    @CurrentUser('id') userGuid: string,
    @Param('uuid') uuid: string,
  ) {
    return this.customClientService.getBuildProgress(uuid, userGuid);
  }

  @Get('builds/:uuid/config')
  @Public()
  async getBuildConfig(@Param('uuid') uuid: string, @Req() req: Request) {
    const buildToken = String(req.headers['x-build-token'] ?? '');
    return this.customClientService.getBuildConfig(uuid, buildToken);
  }

  @Get('builds/:uuid/logo/:filename')
  @Public()
  async downloadBuildLogo(
    @Param('uuid') uuid: string,
    @Param('filename') filename: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const buildToken = String(req.headers['x-build-token'] ?? '');
    const filePath = await this.customClientService.getBuildLogoFile(
      uuid,
      filename,
      buildToken,
    );
    if (!existsSync(filePath)) {
      throw new NotFoundException('Logo file not found');
    }
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      throw new NotFoundException('Logo file not found');
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${basename(filePath)}"`,
    );
    res.setHeader('Content-Length', stat.size);
    const stream = createReadStream(filePath);
    stream.on('error', () => {
      if (res.headersSent) {
        res.destroy();
      } else {
        res.removeHeader('Content-Length');
        res.removeHeader('Content-Disposition');
        res.status(500).end();
      }
    });
    stream.pipe(res);
  }

  @Post('builds/:uuid/upload')
  @Public()
  @HttpCode(HttpStatus.OK)
  async handleUpload(
    @Param('uuid') uuid: string,
    @Req() req: Request,
    @Body() dto: UploadFilesDto,
  ) {
    const buildToken = String(req.headers['x-build-token'] ?? '');
    await this.customClientService.handleUpload(uuid, buildToken, dto.files ?? []);
    return { message: 'Upload processed' };
  }

  @Get('logos')
  @UseGuards(AdminGuard)
  listLogos() {
    return this.logoService.listLogos();
  }

  @Post('logos/:filename')
  @UseGuards(AdminGuard)
  @ConsoleAuditAction('custom_client.logo.upload', {
    targetGuidParam: 'filename',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  @HttpCode(HttpStatus.OK)
  uploadLogo(
    @Param('filename') filename: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    this.logoService.saveLogo(filename, file.buffer);
    return { message: 'Logo uploaded', filename };
  }

  @Delete('logos/:filename')
  @UseGuards(AdminGuard)
  @ConsoleAuditAction('custom_client.logo.delete', {
    targetGuidParam: 'filename',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLogo(@Param('filename') filename: string) {
    this.logoService.deleteLogo(filename);
  }

  @Get('settings')
  @UseGuards(AdminGuard)
  async getSettings() {
    return this.settingsService.getSettings();
  }

  @Put('settings')
  @UseGuards(AdminGuard)
  @ConsoleAuditAction('custom_client.settings.update')
  @HttpCode(HttpStatus.OK)
  async updateSettings(@Body() dto: UpdateCustomClientSettingsDto) {
    return this.settingsService.updateSettings(dto);
  }
}
