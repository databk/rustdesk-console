import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
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

  /**
   * 创建 Nexus 登录会话
   */
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  async createLoginSession(
    @CurrentUser('id') userGuid: string,
    @Body() _dto: NexusLoginDto,
  ) {
    return this.nexusService.createLoginSession(userGuid);
  }

  /**
   * 轮询 Nexus 登录状态
   */
  @Get('auth/status')
  async pollLoginStatus(@Query('login_id') loginId: string) {
    if (!loginId) {
      return { state: 'failed', error: '缺少 login_id 参数' };
    }
    return this.nexusService.pollLoginStatus(loginId);
  }

  /**
   * 查询 Nexus 绑定状态
   */
  @Get('auth/bind-status')
  async getBindStatus(@CurrentUser('id') userGuid: string) {
    return this.nexusService.getBindStatus(userGuid);
  }

  /**
   * 解绑 Nexus 账号
   */
  @Delete('auth/bind')
  @HttpCode(HttpStatus.OK)
  async unbind(@CurrentUser('id') userGuid: string) {
    await this.nexusService.unbind(userGuid);
    return { message: '已解绑 Nexus 账号' };
  }

  /**
   * 提交客户端构建请求
   */
  @Post('client/generate')
  @HttpCode(HttpStatus.OK)
  async submitBuild(
    @CurrentUser('id') userGuid: string,
    @Body() dto: NexusGenerateDto,
  ) {
    return this.nexusService.submitBuild(userGuid, dto);
  }

  /**
   * 查询构建状态
   * 构建完成后后端自动下载产物到本地
   */
  @Get('client/status')
  async getBuildStatus(@CurrentUser('id') userGuid: string) {
    return this.nexusService.getBuildStatus(userGuid);
  }

  /**
   * 列出构建产物的文件列表（从本地存储读取）
   */
  @Get('client/files')
  async listBuildFiles(@Query('request_id') requestId: string) {
    if (!requestId) {
      return [];
    }
    return this.nexusService.listBuildFiles(requestId);
  }

  /**
   * 下载构建产物
   * 直接从本地存储返回文件流
   */
  @Get('client/download')
  async downloadBuildFile(
    @Query('request_id') requestId: string,
    @Query('filename') filename: string,
    @Res() res: Response,
  ) {
    if (!requestId || !filename) {
      res.status(400).json({ message: 'request_id 和 filename 为必填参数' });
      return;
    }

    const filePath = this.nexusService.getLocalFilePath(requestId, filename);

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
