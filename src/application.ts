import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { Request, Response, NextFunction } from 'express';
import { businessWritesAllowed } from './updater/maintenance';

export async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();
  // 维护必须覆盖直接访问后端的客户端，健康检查只暴露固定安全字段。
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (
      !businessWritesAllowed() &&
      request.path !== '/api/system-update/health'
    ) {
      response.status(503).setHeader('Retry-After', '5');
      response.json({
        code: 'SYSTEM_MAINTENANCE',
        message: 'System update maintenance is in progress.',
      });
      return;
    }
    next();
  });

  // 配置 Cookie 解析中间件
  app.use(cookieParser());

  // 设置全局路由前缀
  app.setGlobalPrefix('api');

  // 启用 CORS
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}/api`);
}
