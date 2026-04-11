import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

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

  // Swagger 配置
  const config = new DocumentBuilder()
    .setTitle('RustDesk Console API')
    .setDescription('RustDesk 远程桌面控制台管理系统 API 接口文档')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: '输入 JWT 访问令牌',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('认证', '用户认证相关接口（登录、登出、获取当前用户）')
    .addTag('用户管理', '用户管理接口（需要管理员权限）')
    .addTag('设备组', '设备和设备组管理接口')
    .addTag('地址簿', '地址簿管理接口（包括设备、标签、规则）')
    .addTag('审计', '审计日志记录和查询接口')
    .addTag('系统信息', '设备系统信息上报接口')
    .addTag('心跳', '设备心跳接口')
    .addTag('OIDC', 'OpenID Connect 第三方登录接口（开发中）')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      filter: true,
      showRequestDuration: true,
    },
    customSiteTitle: 'RustDesk Console API 文档',
    customCss: `
      .topbar { display: none; }
      .swagger-ui .topbar { display: none; }
      .information-container { margin: 20px 0; }
    `,
  });

  const port = process.env.PORT ?? 3000;
  logger.log(`Swagger 文档地址: http://localhost:${port}/api-docs`);
  logger.log(`Swagger JSON: http://localhost:${port}/api-docs-json`);

  await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}/api`);
}
bootstrap();
