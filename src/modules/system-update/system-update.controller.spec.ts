import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { SystemUpdateController } from './system-update.controller';
import { SystemUpdateService } from './system-update.service';
import { AdminGuard } from '../../common/guards/admin.guard';
import { UserStatus } from '../user/entities/user.entity';
interface TestRequest {
  headers: { authorization?: string };
  user?: { id: string };
}
describe('authenticated system update API', () => {
  let app: INestApplication;
  const user = { isAdmin: true, status: UserStatus.ACTIVE };
  const service = {
    capabilities: jest.fn(() => ({
      protocolVersion: 1,
      supported: false,
      ready: false,
      blockers: [
        { code: 'HELPER_NOT_INSTALLED', message: 'Manual migration required.' },
      ],
    })),
    plan: jest.fn(() => ({ planId: 'server-selected', executable: false })),
    create: jest.fn((body: { planId: string }) => ({
      jobId: 'persisted-job',
      planId: body.planId,
    })),
    current: jest.fn(() => ({ installationId: 'installation', job: null })),
    job: jest.fn(() => ({ jobId: 'persisted-job' })),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SystemUpdateController],
      providers: [
        { provide: SystemUpdateService, useValue: service },
        AdminGuard,
        {
          provide: DataSource,
          useValue: {
            getRepository: () => ({ findOne: () => Promise.resolve(user) }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalGuards({
      canActivate(context) {
        const req = context.switchToHttp().getRequest<TestRequest>();
        if (req.headers.authorization !== 'Bearer test-admin')
          throw new UnauthorizedException();
        req.user = { id: 'admin-id' };
        return true;
      },
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    user.isAdmin = true;
    user.status = UserStatus.ACTIVE;
    jest.clearAllMocks();
  });
  afterAll(async () => {
    await app.close();
  });
  test('missing identity returns 401 and a revoked database administrator returns 403', async () => {
    await request(app.getHttpServer())
      .get('/api/system-update/capabilities')
      .expect(401);
    user.isAdmin = false;
    await request(app.getHttpServer())
      .get('/api/system-update/capabilities')
      .set('Authorization', 'Bearer test-admin')
      .expect(403);
    expect(service.capabilities).not.toHaveBeenCalled();
  });
  test('old installs retain an explicit capability response', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/system-update/capabilities')
      .set('Authorization', 'Bearer test-admin')
      .expect(200);
    expect(response.body).toMatchObject({
      supported: false,
      blockers: [{ code: 'HELPER_NOT_INSTALLED' }],
    });
  });
  test('plans accept only an empty server-selected request', async () => {
    await request(app.getHttpServer())
      .post('/api/system-update/plans')
      .set('Authorization', 'Bearer test-admin')
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/system-update/plans')
      .set('Authorization', 'Bearer test-admin')
      .send({ version: '9.0.0', url: 'https://attacker.test' })
      .expect(400);
    expect(service.plan).toHaveBeenCalledTimes(1);
  });
  test('jobs validate UUID, explicit downtime consent and unknown fields, then return 202', async () => {
    const body = {
      planId: randomUUID(),
      idempotencyKey: randomUUID(),
      acknowledgeDowntime: true,
    };
    await request(app.getHttpServer())
      .post('/api/system-update/jobs')
      .set('Authorization', 'Bearer test-admin')
      .send({ ...body, acknowledgeDowntime: false })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/system-update/jobs')
      .set('Authorization', 'Bearer test-admin')
      .send({ ...body, command: 'untrusted' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/system-update/jobs')
      .set('Authorization', 'Bearer test-admin')
      .send({ ...body, planId: '../../escape' })
      .expect(400);
    const response = await request(app.getHttpServer())
      .post('/api/system-update/jobs')
      .set('Authorization', 'Bearer test-admin')
      .send(body)
      .expect(202);
    expect(response.body.jobId).toBe('persisted-job');
    expect(service.create).toHaveBeenCalledWith(body, 'admin-id');
  });
  test('current is routed before UUID lookup and invalid IDs never reach service', async () => {
    await request(app.getHttpServer())
      .get('/api/system-update/jobs/current')
      .set('Authorization', 'Bearer test-admin')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/system-update/jobs/invalid')
      .set('Authorization', 'Bearer test-admin')
      .expect(400);
    expect(service.current).toHaveBeenCalledTimes(1);
    expect(service.job).not.toHaveBeenCalled();
  });
});
