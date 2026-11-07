import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';

jest.mock('uuid', () => {
  const cryptoModule =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { v4: cryptoModule.randomUUID };
});
import {
  ConsoleAuditAction,
  ConsoleAuditActionMetadata,
} from '../decorators/console-audit-action.decorator';
import { SkipConsoleAudit } from '../decorators/skip-console-audit.decorator';
import { RbacAuditService } from '../services/rbac-audit.service';
import { ConsoleAuditInterceptor } from './console-audit.interceptor';

class TestController {
  @ConsoleAuditAction('user.create')
  create() {}

  @ConsoleAuditAction('user.profile.update', { targetGuidActor: true })
  updateSelf() {}

  @ConsoleAuditAction('address_book.update', {
    targetGuidBodyField: 'guid',
    includeBody: false,
  })
  updateAddressBook() {}

  @SkipConsoleAudit()
  @ConsoleAuditAction('user.delete')
  skip() {}

  unannotated() {}
}

interface TestRequest {
  method: string;
  id?: string;
  user?: { id?: string };
  params?: Record<string, string>;
  body?: unknown;
}

function contextFor(
  handler: (...args: never[]) => unknown,
  request: TestRequest,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function callHandler(value: unknown = { ok: true }): CallHandler {
  return { handle: () => of(value) };
}

function createInterceptor() {
  const record = jest.fn().mockResolvedValue(undefined);
  const interceptor = new ConsoleAuditInterceptor(new Reflector(), {
    record,
  } as unknown as RbacAuditService);
  return { interceptor, record };
}

const handler = (name: keyof TestController) => TestController.prototype[name];

describe('ConsoleAuditInterceptor', () => {
  it('records the canonical action and route target', async () => {
    const { interceptor, record } = createInterceptor();
    const request: TestRequest = {
      method: 'POST',
      id: 'request-1',
      user: { id: 'actor-1' },
      params: { guid: 'user-9' },
      body: { name: 'Alice' },
    };

    await expect(
      lastValueFrom(
        interceptor.intercept(
          contextFor(handler('create'), request),
          callHandler(),
        ),
      ),
    ).resolves.toEqual({ ok: true });

    expect(record).toHaveBeenCalledWith({
      actorUserGuid: 'actor-1',
      targetType: 'user',
      targetGuid: 'user-9',
      action: 'user.create',
      result: 'allowed',
      afterState: { name: 'Alice' },
      requestId: 'request-1',
    });
  });

  it('uses the actor as target for self-service actions', async () => {
    const { interceptor, record } = createInterceptor();

    await lastValueFrom(
      interceptor.intercept(
        contextFor(handler('updateSelf'), {
          method: 'PATCH',
          user: { id: 'actor-1' },
          body: { display_name: 'Alice' },
        }),
        callHandler(),
      ),
    );

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'user',
        targetGuid: 'actor-1',
        action: 'user.profile.update',
      }),
    );
  });

  it('resolves a body target and can omit the request body from the audit', async () => {
    const { interceptor, record } = createInterceptor();

    await lastValueFrom(
      interceptor.intercept(
        contextFor(handler('updateAddressBook'), {
          method: 'PUT',
          user: { id: 'actor-1' },
          body: { guid: 'book-1', name: 'Team' },
        }),
        callHandler(),
      ),
    );

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'address_book',
        targetGuid: 'book-1',
        action: 'address_book.update',
        afterState: undefined,
      }),
    );
  });

  it('ignores mutations without an explicit audit action', async () => {
    const { interceptor, record } = createInterceptor();

    await lastValueFrom(
      interceptor.intercept(
        contextFor(handler('unannotated'), {
          method: 'POST',
          user: { id: 'actor-1' },
        }),
        callHandler(),
      ),
    );

    expect(record).not.toHaveBeenCalled();
  });

  it('lets @SkipConsoleAudit win over an audit action', async () => {
    const { interceptor, record } = createInterceptor();

    await lastValueFrom(
      interceptor.intercept(
        contextFor(handler('skip'), {
          method: 'DELETE',
          user: { id: 'actor-1' },
        }),
        callHandler(),
      ),
    );

    expect(record).not.toHaveBeenCalled();
  });

  it('ignores read requests, anonymous requests, and endpoints without a user', async () => {
    const { interceptor, record } = createInterceptor();

    await lastValueFrom(
      interceptor.intercept(
        contextFor(handler('create'), {
          method: 'GET',
          user: { id: 'actor-1' },
        }),
        callHandler(),
      ),
    );
    await lastValueFrom(
      interceptor.intercept(
        contextFor(handler('create'), { method: 'POST' }),
        callHandler(),
      ),
    );

    expect(record).not.toHaveBeenCalled();
  });

  it('does not fail the request when the audit write fails', async () => {
    const { interceptor, record } = createInterceptor();
    record.mockRejectedValueOnce(new Error('db down'));

    await expect(
      lastValueFrom(
        interceptor.intercept(
          contextFor(handler('create'), {
            method: 'POST',
            user: { id: 'actor-1' },
          }),
          callHandler('response'),
        ),
      ),
    ).resolves.toBe('response');
  });
});

describe('ConsoleAuditAction', () => {
  it('rejects route-style action names', () => {
    expect(() => ConsoleAuditAction('POST /api/users')).toThrow(
      'Invalid console audit action',
    );
  });

  it('accepts canonical resource-dot verbs', () => {
    expect(() =>
      ConsoleAuditAction('auth.2fa.setup', { targetGuidActor: true }),
    ).not.toThrow();
    const metadata = Reflect.getMetadata(
      'consoleAuditAction',
      TestController.prototype.updateSelf,
    ) as ConsoleAuditActionMetadata;
    expect(metadata.action).toBe('user.profile.update');
  });
});
