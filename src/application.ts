import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { Request, Response, NextFunction } from 'express';
import { businessWritesAllowed } from './updater/maintenance';
import { rbacRequestScopeMiddleware } from './modules/rbac/rbac-request-scope.middleware';
import {
  isValidLogLevel,
  resolveLogLevels,
} from './common/utils/log-level.util';

export async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: resolveLogLevels(process.env.LOG_LEVEL),
  });
  const logger = new Logger('Bootstrap');
  if (!isValidLogLevel(process.env.LOG_LEVEL)) {
    logger.warn(
      `Unknown LOG_LEVEL "${process.env.LOG_LEVEL}", falling back to "log". ` +
        'Use one of: verbose, debug, log (info), warn, error, fatal.',
    );
  }

  app.enableShutdownHooks();

  // Bind the request-scoped RBAC cache before anything else so guards,
  // interceptors and handlers all share one authorization snapshot.
  app.use(rbacRequestScopeMiddleware);
  // Direct backend clients must also respect the persistent maintenance fence.
  app.use((request: Request, response: Response, next: NextFunction) => {
    const isSystemUpdateStatusRequest =
      request.method === 'GET' &&
      (request.path === '/api/system-update/jobs/current' ||
        /^\/api\/system-update\/jobs\/[^/]+$/.test(request.path));

    if (
      !businessWritesAllowed() &&
      request.path !== '/api/system-update/health' &&
      !isSystemUpdateStatusRequest
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

  // Configure cookie parsing middleware
  app.use(cookieParser());

  // Set global route prefix
  app.setGlobalPrefix('api');

  // Enable CORS
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  const host = process.env.HOST;
  if (host) await app.listen(port, host);
  else await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}/api`);
}
