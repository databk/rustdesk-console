import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const AVATAR_DIR = path.join(process.cwd(), 'uploads', 'avatars');

@Public()
@Controller('avatars')
export class AvatarController {
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Get(':filename')
  getAvatar(@Param('filename') filename: string, @Res() res: Response) {
    if (!filename.match(/^[a-f0-9-]+\.webp$/)) {
      throw new NotFoundException();
    }

    const filePath = path.join(AVATAR_DIR, filename);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException();
    }

    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  }
}
