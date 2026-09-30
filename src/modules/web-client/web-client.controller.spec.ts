import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../auth/services/auth.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JWT_DEFAULT_SECRET } from '../auth/auth.constants';
import { RbacGuard } from '../rbac/guards/rbac.guard';
import { RbacAuthorizationService } from '../rbac/services/rbac-authorization.service';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';
import { WebClientController } from './web-client.controller';
import { WebClientService } from './web-client.service';

jest.mock('uuid', () => {
  const cryptoModule =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { v4: cryptoModule.randomUUID };
});
jest.mock('openid-client', () => ({}));

describe('authenticated web client configuration', () => {
  let app: INestApplication;
  const jwt = new JwtService({
    secret: process.env.JWT_SECRET || JWT_DEFAULT_SECRET,
  });
  const permissions = {
    requirePermission: jest.fn(),
    requireSuperAdmin: jest.fn(),
  };
  const revoked = new Set<string>();
  const profile = {
    WEB_CLIENT_ENABLED: 'true',
    WEB_CLIENT_ID_SERVER_URL: 'wss://remote.example.com/id',
    WEB_CLIENT_RELAY_SERVER_URL: 'wss://remote.example.com/relay',
    WEB_CLIENT_SERVER_PUBLIC_KEY: Buffer.alloc(32).toString('base64'),
  };
  const config = new ConfigService(profile);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [WebClientController],
      providers: [
        WebClientService,
        JwtStrategy,
        { provide: ConfigService, useValue: config },
        {
          provide: AuthService,
          useValue: {
            validateToken: (token: string) =>
              revoked.has(token) ? null : jwt.decode(token),
          },
        },
        { provide: RbacAuthorizationService, useValue: permissions },
        { provide: RbacAuditService, useValue: { recordDenied: jest.fn() } },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RbacGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('rejects missing, invalid, expired and revoked Console sessions', async () => {
    await request(app.getHttpServer())
      .get('/api/web-client/config')
      .expect(401);
    for (const token of [
      'invalid',
      jwt.sign({ sub: 'ordinary' }, { expiresIn: -1 }),
    ]) {
      await request(app.getHttpServer())
        .get('/api/web-client/config')
        .auth(token, { type: 'bearer' })
        .expect(401);
    }
    const token = jwt.sign({ sub: 'revoked' });
    revoked.add(token);
    await request(app.getHttpServer())
      .get('/api/web-client/config')
      .auth(token, { type: 'bearer' })
      .expect(401);
  });

  it('allows an ordinary account without devices.view and never checks device permissions', async () => {
    const token = jwt.sign({ sub: 'ordinary', isAdmin: false });
    const result = await request(app.getHttpServer())
      .get('/api/web-client/config')
      .auth(token, { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(result.body).toEqual({
      enabled: true,
      idServerUrl: profile.WEB_CLIENT_ID_SERVER_URL,
      relayServerUrl: profile.WEB_CLIENT_RELAY_SERVER_URL,
      serverPublicKey: profile.WEB_CLIENT_SERVER_PUBLIC_KEY,
    });
    expect(permissions.requirePermission).not.toHaveBeenCalled();
    expect(permissions.requireSuperAdmin).not.toHaveBeenCalled();
  });

  it('returns disabled and invalid configurations without affecting authentication', async () => {
    const token = jwt.sign({ sub: 'ordinary', isAdmin: false });
    config.set('WEB_CLIENT_ENABLED', 'false');
    await request(app.getHttpServer())
      .get('/api/web-client/config')
      .auth(token, { type: 'bearer' })
      .expect(200, { enabled: false });
    config.set('WEB_CLIENT_ENABLED', 'true');
    config.set(
      'WEB_CLIENT_ID_SERVER_URL',
      'wss://private:secret@remote.example.com',
    );
    const result = await request(app.getHttpServer())
      .get('/api/web-client/config')
      .auth(token, { type: 'bearer' })
      .expect(503);
    expect(result.body.message).toBe('Web client configuration is unavailable');
    expect(JSON.stringify(result.body)).not.toContain('secret');
  });
});
