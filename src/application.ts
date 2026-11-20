import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import express from 'express';
import { join, dirname } from 'path';
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
          // 关键！fnOS Native / 直接端口都是 HTTP，禁用 Helmet 默认的
          // upgrade-insecure-requests — 它会让浏览器把所有资源请求
          // 升级成 HTTPS → Sea 不跑 TLS → ERR_SSL_PROTOCOL_ERROR 白屏
          upgradeInsecureRequests: null,
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

  // ── Serve 前端静态文件 + SPA fallback ────────────────────────────
  // 用 express.static 而不是 NestJS ServeStaticModule，因为 SetGlobalPrefix('api')
  // 会让 ServeStaticModule 的 rootPath 变成 /api/public，导致 /xxx.js 404。
  // express.static 注册在 NestJS module 初始化之后、listen 之前，不受 globalPrefix 影响。
  const publicDir = join(dirname(process.execPath), 'public');
  app.use(express.static(publicDir));
  // SPA fallback: 所有非 /api/* 的 GET/HEAD 请求返回 index.html
  // （让 React Router 处理 /setup、/login 等前端路由）
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.path.startsWith('/api')) {
      return next();
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return next();
    }
    const indexHtml = join(publicDir, 'index.html');
    response.sendFile(indexHtml, (err) => {
      if (err) next();
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
