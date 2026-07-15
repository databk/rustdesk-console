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
      return { state: 'failed', error: '缺少 login_id 参数' };
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
    return { message: '已解绑 Nexus 账号' };
  }

  // ── Builds (RESTful) ──────────────────────────────────

  /** 提交客户端构建请求 */
  @Post('builds')
  @HttpCode(HttpStatus.CREATED)
  async createBuild(
    @CurrentUser('id') userGuid: string,
    @Body() dto: NexusGenerateDto,
  ) {
    return this.nexusService.submitBuild(userGuid, dto);
  }

  /** 获取当前用户的所有构建记录（含实时状态） */
  @Get('builds')
  async listBuilds(@CurrentUser('id') userGuid: string) {
    return this.nexusService.listBuilds(userGuid);
  }

  /** 删除构建记录 */
  @Delete('builds/:uuid')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBuild(
    @CurrentUser('id') userGuid: string,
    @Param('uuid') uuid: string,
  ) {
    await this.nexusService.deleteBuild(userGuid, uuid);
  }

  // ── Files & Download ──────────────────────────────────

  /** 列出构建产物的文件列表 */
  @Get('builds/:uuid/files')
  listBuildFiles(@Param('uuid') uuid: string) {
    return this.nexusService.listBuildFiles(uuid);
  }

  /** 下载构建产物 */
  @Get('builds/:uuid/files/:filename')
  downloadBuildFile(
    @Param('uuid') uuid: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const filePath = this.nexusService.getLocalFilePath(uuid, filename);

    if (!existsSync(filePath)) {
      throw new NotFoundException('文件不存在');
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
