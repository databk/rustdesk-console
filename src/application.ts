import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';
import { businessWritesAllowed } from './updater/maintenance';
import { rbacRequestScopeMiddleware } from './modules/rbac/rbac-request-scope.middleware';
import {
  REQUEST_ID_HEADER,
  requestIdMiddleware,
} from './common/middleware/request-id.middleware';
import {
  isValidLogLevel,
  resolveLogLevels,
} from './common/utils/log-level.util';
import { DataSource } from 'typeorm';

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

  // ── Helmet security headers (first, before anything else) ──────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        // console is served by its own reverse proxy; keep permissive but
        // disable dangerous inline script by default
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      // Required for JWT Bearer auth headers to stay visible
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Assign the correlation ID first so every response, including maintenance
  // rejections, carries it and all audit records of a request share it.
  app.use(requestIdMiddleware);
  // Bind the request-scoped RBAC cache before the remaining middleware so
  // guards, interceptors and handlers all share one authorization snapshot.
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

  // ── CORS: dynamic origin check ──────────────────────────────────────
  // Before setup completes we permit any Origin so the setup wizard works
  // from any preview/dev environment. After setup we lock CORS to the
  // saved frontendUrl — prevents CSRF against public POST endpoints.
  const dataSource = app.get(DataSource);
  app.use((request: Request, response: Response, next: NextFunction) => {
    const incomingOrigin = request.headers.origin as string | undefined;
    if (!incomingOrigin) {
      next();
      return;
    }

    // Allow setup endpoints before lock-in
    if (
      request.path === '/api/settings/setup' &&
      (request.method === 'GET' ||
        request.method === 'POST' ||
        (request.method as string) === 'OPTIONS')
    ) {
      response.setHeader('Access-Control-Allow-Origin', incomingOrigin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, OPTIONS',
      );
      response.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization',
      );
      if ((request.method as string) === 'OPTIONS') {
        response.statusCode = 204;
        response.end();
        return;
      }
      next();
      return;
    }

    // Check setup state via DB (lightweight — one query per request, but
    // only until setup completes; after that frontendUrl stays cached here)
    const cached = (bootstrap as any).__allowedOrigin;
    if (cached) {
      applyCors(incomingOrigin, cached, response);
      if (request.method === 'OPTIONS') {
        response.statusCode = 204;
        response.end();
        return;
      }
      next();
      return;
    }

    // Try DB lookup; fall back to permissive if not yet ready
    (async () => {
      try {
        const row = await dataSource
          .query(
            "SELECT value FROM settings WHERE key = 'general.site.frontendUrl' LIMIT 1",
          )
          .catch(() => null);
        const savedUrl: string | undefined = row?.[0]?.value;
        if (savedUrl) {
          (bootstrap as any).__allowedOrigin = savedUrl;
          applyCors(incomingOrigin, savedUrl, response);
        } else {
          // Setup not done yet — permissive
          response.setHeader('Access-Control-Allow-Origin', incomingOrigin);
          response.setHeader('Access-Control-Allow-Credentials', 'true');
          response.setHeader(
            'Access-Control-Allow-Methods',
            'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          );
          response.setHeader(
            'Access-Control-Allow-Headers',
            'Content-Type, Authorization, X-Requested-With',
          );
        }
      } catch {
        response.setHeader('Access-Control-Allow-Origin', incomingOrigin);
      }
      if (request.method === 'OPTIONS') {
        response.statusCode = 204;
        response.end();
        return;
      }
      next();
    })();
  });

  function applyCors(
    origin: string,
    allowed: string,
    response: Response,
  ): void {
    if (origin === allowed) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      );
      response.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With',
      );
    } else {
      // Vary: Origin so CDNs cache correctly
      response.setHeader('Vary', 'Origin');
    }
  }

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // ── SPA fallback for React Router ──────────────────────────────────
  // ServeStaticModule 先尝试从 public/ serve 文件；不存在时 Express
  // 把请求传给我们。这里捕获所有非 /api/* 的请求，返回 index.html，
  // 让 React Router 在浏览器里处理 /setup、/login 等前端路由。
  const path = await import('path');
  app.use((request: Request, response: Response, next: NextFunction) => {
    // 只 catch 非 API 路由
    if (request.path.startsWith('/api')) {
      return next();
    }
    // 只处理 GET/HEAD，其它 HTTP 方法让 NestJS 处理（会返回 404 JSON）
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return next();
    }
    // public/index.html 用 process.execPath 的 dirname（SEA 兼容）
    const indexHtml = path.join(
      path.dirname(process.execPath),
      'public',
      'index.html',
    );
    response.sendFile(indexHtml, (err) => {
      if (err) {
        // public/ 不存在或 index.html 缺失 → 让 NestJS 返回它的 404
        next();
      }
    });
  });

  const port = process.env.PORT ?? 3000;
  const host = process.env.HOST;
  if (host) await app.listen(port, host);
  else await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}/api`);
}

/**
 * Invalidate the cached allowed CORS origin after setup writes a new
 * frontendUrl. Called from SetupService.complete() once the DB row is
 * committed so subsequent requests pick up the lock.
 */
export function clearAllowedOriginCache(): void {
  (bootstrap as any).__allowedOrigin = undefined;
}
