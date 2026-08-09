import {
  Controller,
  Get,
  Param,
  Req,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import type { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getAvatarDir } from '../../common/utils/data-dir.util';

const AVATAR_DIR = getAvatarDir();

@Public()
@Controller('avatars')
export class AvatarController {
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Get(':filename')
  getAvatar(
    @Param('filename') filename: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!filename.match(/^[a-f0-9-]+\.webp$/)) {
      throw new NotFoundException();
    }

    const avatarRoot = path.resolve(AVATAR_DIR) + path.sep;
    const filePath = path.resolve(AVATAR_DIR, filename);
    if (!filePath.startsWith(avatarRoot)) {
      throw new NotFoundException();
    }

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException();
    }

    const stat = fs.statSync(filePath);
    const etag = `"${stat.size.toString(16)}-${stat.mtime.getTime().toString(16)}"`;

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    res.setHeader('Content-Type', 'image/webp');
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  }
}
