import type { NextFunction, Request, Response } from 'express';
import { Repository } from 'typeorm';
import { requestIdMiddleware } from '../../../common/middleware/request-id.middleware';
import { ConsoleAudit } from '../entities/console-audit.entity';
import { RbacAuditService } from './rbac-audit.service';

jest.mock('uuid', () => {
  const cryptoModule =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { v4: cryptoModule.randomUUID };
});

describe('RbacAuditService request correlation', () => {
  const repository = {
    create: jest.fn((audit: Partial<ConsoleAudit>) => audit),
    save: jest.fn((audit: Partial<ConsoleAudit>) => Promise.resolve(audit)),
  };
  const service = new RbacAuditService(
    repository as unknown as Repository<ConsoleAudit>,
  );
  const event = {
    actorUserGuid: 'user-1',
    targetType: 'role',
    targetGuid: 'role-1',
    action: 'role.update',
    result: 'allowed' as const,
  };

  /** Runs the callback inside the request scope opened by the middleware. */
  function withinRequest<T>(
    requestId: string,
    callback: () => Promise<T>,
    headers: Record<string, string> = {},
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const next: NextFunction = () => {
        callback().then(resolve, reject);
      };
      requestIdMiddleware(
        {
          headers: { ...headers, 'x-request-id': requestId },
          socket: { remoteAddress: '203.0.113.7' },
        } as unknown as Request,
        { setHeader: jest.fn() } as unknown as Response,
        next,
      );
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stamps service-level records with the current request ID', async () => {
    const audit = await withinRequest('req-1', () => service.record(event));

    expect(audit.requestId).toBe('req-1');
  });

  it('stamps denials with the current request ID', async () => {
    await withinRequest('req-2', () => service.recordDenied(event));

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'denied', requestId: 'req-2' }),
    );
  });

  it('keeps an explicitly supplied request ID', async () => {
    const audit = await withinRequest('req-3', () =>
      service.record({ ...event, requestId: 'session-guid' }),
    );

    expect(audit.requestId).toBe('session-guid');
  });

  it('stores no request ID outside an HTTP request', async () => {
    const audit = await service.record(event);

    expect(audit.requestId).toBeNull();
  });

  it('stamps records with the client IP and User-Agent of the request', async () => {
    const audit = await withinRequest('req-4', () => service.record(event), {
      'user-agent': 'Mozilla/5.0',
    });

    expect(audit).toMatchObject({
      clientIp: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });
  });

  it('stamps denials with the client IP of the request', async () => {
    await withinRequest('req-5', () => service.recordDenied(event));

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'denied', clientIp: '203.0.113.7' }),
    );
  });

  it('keeps an explicitly supplied client IP and User-Agent', async () => {
    const audit = await withinRequest('req-6', () =>
      service.record({
        ...event,
        clientIp: '198.51.100.9',
        userAgent: 'RustDesk',
      }),
    );

    expect(audit).toMatchObject({
      clientIp: '198.51.100.9',
      userAgent: 'RustDesk',
    });
  });

  it('bounds values to the audited column widths', async () => {
    const audit = await service.record({
      ...event,
      clientIp: 'x'.repeat(46),
      userAgent: 'a'.repeat(600),
    });

    expect(audit.clientIp).toBeNull();
    expect(audit.userAgent).toBe('a'.repeat(512));
  });

  it('stores no client origin outside an HTTP request', async () => {
    const audit = await service.record(event);

    expect(audit.clientIp).toBeNull();
    expect(audit.userAgent).toBeNull();
  });
});
