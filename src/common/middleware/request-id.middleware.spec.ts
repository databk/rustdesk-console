import type { NextFunction, Request, Response } from 'express';
import {
  getCurrentRequestId,
  requestIdMiddleware,
  resolveRequestId,
  type RequestWithId,
} from './request-id.middleware';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function run(header?: string | string[]) {
  const request = {
    headers: header === undefined ? {} : { 'x-request-id': header },
  } as unknown as RequestWithId;
  const response = { setHeader: jest.fn() };
  let scopedId: string | undefined;
  const next: NextFunction = () => {
    scopedId = getCurrentRequestId();
  };
  requestIdMiddleware(
    request as Request,
    response as unknown as Response,
    next,
  );
  return { request, response, scopedId };
}

describe('resolveRequestId', () => {
  it.each(['req-1', 'b7d0c1f2.Trace:42_x', 'a'.repeat(128)])(
    'reuses the well-formed upstream ID %s',
    (value) => {
      expect(resolveRequestId(value)).toBe(value);
    },
  );

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['too long', 'a'.repeat(129)],
    ['containing spaces', 'req 1'],
    ['containing control characters', 'req-1\r\nX-Injected: 1'],
    ['repeated', ['req-1', 'req-2']],
  ])('generates a UUID when the upstream ID is %s', (_case, value) => {
    expect(resolveRequestId(value)).toMatch(UUID);
  });
});

describe('requestIdMiddleware', () => {
  it('assigns, returns and scopes a generated ID', () => {
    const { request, response, scopedId } = run();

    expect(request.id).toMatch(UUID);
    expect(response.setHeader).toHaveBeenCalledWith('X-Request-Id', request.id);
    expect(scopedId).toBe(request.id);
  });

  it('keeps a valid upstream ID end to end', () => {
    const { request, response, scopedId } = run('gateway-123');

    expect(request.id).toBe('gateway-123');
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      'gateway-123',
    );
    expect(scopedId).toBe('gateway-123');
  });

  it('gives each request its own ID', () => {
    expect(run().request.id).not.toBe(run().request.id);
  });

  it('keeps the ID across asynchronous work in the request', async () => {
    const request = { headers: {} } as RequestWithId;
    const observed = await new Promise<string | undefined>((resolve) => {
      requestIdMiddleware(
        request as Request,
        { setHeader: jest.fn() } as unknown as Response,
        () => {
          setImmediate(() => {
            void Promise.resolve().then(() => resolve(getCurrentRequestId()));
          });
        },
      );
    });

    expect(observed).toBe(request.id);
  });

  it('exposes no ID outside a request', () => {
    run('req-1');
    expect(getCurrentRequestId()).toBeUndefined();
  });
});
