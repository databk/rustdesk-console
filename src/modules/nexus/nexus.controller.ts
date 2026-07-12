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
} from '@nestjs/common';
import type { Response } from 'express';
import { NexusService } from './nexus.service';
import { NexusLoginDto } from './dto/nexus-auth.dto';
import { NexusGenerateDto } from './dto/nexus-client.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('nexus')
export class NexusController {
  constructor(private readonly nexusService: NexusService) {}

  /**
   * 创建 Nexus 登录会话
   * 调用 Nexus API 获取 login_id 和 auth_url，前端打开 auth_url 引导用户授权
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
   * 前端每 2-3 秒轮询此接口，登录成功后后端自动存储 Nexus Token
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
   */
  @Get('client/status')
  async getBuildStatus(@CurrentUser('id') userGuid: string) {
    return this.nexusService.getBuildStatus(userGuid);
  }

  /**
   * 列出构建产物的文件列表
   * 构建完成后，前端先调用此接口获取可下载的文件名列表
   */
  @Get('client/files')
  async listBuildFiles(
    @CurrentUser('id') userGuid: string,
    @Query('request_id') requestId: string,
  ) {
    if (!requestId) {
      return [];
    }
    return this.nexusService.listBuildFiles(userGuid, requestId);
  }

  /**
   * 下载构建产物
   * 流式转发指定文件
   */
  @Get('client/download')
  async downloadBuildFile(
    @CurrentUser('id') userGuid: string,
    @Query('request_id') requestId: string,
    @Query('filename') filename: string,
    @Res() res: Response,
  ) {
    if (!requestId || !filename) {
      res.status(400).json({ message: 'request_id 和 filename 为必填参数' });
      return;
    }

    const result = await this.nexusService.downloadBuildFile(
      userGuid,
      requestId,
      filename,
    );

    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );

    if (!result.stream) {
      res.status(500).send('下载失败');
      return;
    }

    const reader = result.stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch {
      res.end();
    }
  }
}
