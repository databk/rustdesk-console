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
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const next: NextFunction = () => {
        callback().then(resolve, reject);
      };
      requestIdMiddleware(
        { headers: { 'x-request-id': requestId } } as unknown as Request,
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
});
