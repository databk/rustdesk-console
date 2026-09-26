import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, existsSync, statSync } from 'fs';
import { basename } from 'path';
import { NexusService } from './nexus.service';
import { NexusLoginDto } from './dto/nexus-auth.dto';
import { NexusGenerateDto } from './dto/nexus-client.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('nexus')
export class NexusController {
  constructor(private readonly nexusService: NexusService) {}

  // ── Auth ──────────────────────────────────────────────

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  async createLoginSession(
    @CurrentUser('id') userGuid: string,
    @Body() _dto: NexusLoginDto,
  ) {
    return this.nexusService.createLoginSession(userGuid);
  }

  @Get('auth/status')
  async pollLoginStatus(@Query('login_id') loginId: string) {
    if (!loginId) {
      return { state: 'failed', error: 'Missing login_id parameter' };
    }
    return this.nexusService.pollLoginStatus(loginId);
  }

  @Get('auth/bind-status')
  async getBindStatus(@CurrentUser('id') userGuid: string) {
    return this.nexusService.getBindStatus(userGuid);
  }

  @Delete('auth/bind')
  @HttpCode(HttpStatus.OK)
  async unbind(@CurrentUser('id') userGuid: string) {
    await this.nexusService.unbind(userGuid);
    return { message: 'Nexus account unbound' };
  }

  // ── Builds (RESTful) ──────────────────────────────────

  /** Submit a client build request */
  @Post('builds')
  @HttpCode(HttpStatus.CREATED)
  async createBuild(
    @CurrentUser('id') userGuid: string,
    @Body() dto: NexusGenerateDto,
  ) {
    return this.nexusService.submitBuild(userGuid, dto);
  }

  /** Get all build records of the current user (including live status) */
  @Get('builds')
  async listBuilds(@CurrentUser('id') userGuid: string) {
    return this.nexusService.listBuilds(userGuid);
  }

  /** Delete a build record */
  @Delete('builds/:uuid')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBuild(
    @CurrentUser('id') userGuid: string,
    @Param('uuid') uuid: string,
  ) {
    await this.nexusService.deleteBuild(userGuid, uuid);
  }

  // ── Files & Download ──────────────────────────────────

  /** List the build artifact files */
  @Get('builds/:uuid/files')
  listBuildFiles(@Param('uuid') uuid: string) {
    return this.nexusService.listBuildFiles(uuid);
  }

  /** Download build artifact */
  @Get('builds/:uuid/files/:filename')
  downloadBuildFile(
    @Param('uuid') uuid: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const filePath = this.nexusService.getLocalFilePath(uuid, filename);

    if (!existsSync(filePath)) {
      throw new NotFoundException('File not found');
    }

    const stat = statSync(filePath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${basename(filePath)}"`,
    );
    res.setHeader('Content-Length', stat.size);

    const stream = createReadStream(filePath);
    stream.pipe(res);
  }
}
