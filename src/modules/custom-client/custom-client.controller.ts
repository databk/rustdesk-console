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
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { createReadStream, existsSync, statSync } from 'fs';
import { basename } from 'path';
import { CustomClientService } from './custom-client.service';
import { CustomClientSettingsService } from './services/custom-client-settings.service';
import { SubmitBuildDto } from './dto/custom-client-build.dto';
import { UpdateCustomClientSettingsDto } from './dto/custom-client-settings.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';

@Controller('custom-client')
export class CustomClientController {
  constructor(
    private readonly customClientService: CustomClientService,
    private readonly settingsService: CustomClientSettingsService,
  ) {}

  @Post('builds')
  @HttpCode(HttpStatus.CREATED)
  async createBuild(
    @CurrentUser('id') userGuid: string,
    @Body() dto: SubmitBuildDto,
  ) {
    return this.customClientService.submitBuild(userGuid, dto);
  }

  @Get('builds')
  async listBuilds(@CurrentUser('id') userGuid: string) {
    return this.customClientService.listBuilds(userGuid);
  }

  @Delete('builds/:uuid')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBuild(
    @CurrentUser('id') userGuid: string,
    @Param('uuid') uuid: string,
  ) {
    await this.customClientService.deleteBuild(userGuid, uuid);
  }

  @Get('builds/:uuid/files')
  async listBuildFiles(
    @CurrentUser('id') userGuid: string,
    @Param('uuid') uuid: string,
  ) {
    return this.customClientService.listBuildFiles(uuid, userGuid);
  }

  @Get('builds/:uuid/files/:filename')
  async downloadBuildFile(
    @CurrentUser('id') userGuid: string,
    @Param('uuid') uuid: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const filePath = await this.customClientService.getLocalFilePath(
      uuid,
      filename,
      userGuid,
    );
    if (!existsSync(filePath)) {
      throw new NotFoundException('File not found');
    }
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      throw new NotFoundException('File not found');
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

  @Get('builds/:uuid/progress')
  async getBuildProgress(
    @CurrentUser('id') userGuid: string,
    @Param('uuid') uuid: string,
  ) {
    return this.customClientService.getBuildProgress(uuid, userGuid);
  }

  @Post('builds/:uuid/callback')
  @Public()
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      limits: { fileSize: 200 * 1024 * 1024, files: 10 },
    }),
  )
  @HttpCode(HttpStatus.OK)
  async handleCallback(
    @Param('uuid') uuid: string,
    @Req() req: Request,
    @Body() body: { status?: string; message?: string },
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const callbackToken = String(req.headers['x-callback-token'] ?? '');
    await this.customClientService.handleCallback(
      uuid,
      callbackToken,
      body?.status ?? 'completed',
      body?.message,
      files ?? [],
    );
    return { message: 'Callback processed' };
  }

  @Get('settings')
  @UseGuards(AdminGuard)
  async getSettings() {
    return this.settingsService.getSettings();
  }

  @Put('settings')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async updateSettings(@Body() dto: UpdateCustomClientSettingsDto) {
    return this.settingsService.updateSettings(dto);
  }
}
