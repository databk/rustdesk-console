import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  requestLoggingMiddleware,
  requestLogLevel,
} from './request-logging.middleware';

describe('requestLogLevel', () => {
  it.each([
    [200, 'debug'],
    [204, 'debug'],
    [302, 'debug'],
    [401, 'debug'],
    [404, 'debug'],
    [400, 'warn'],
    [403, 'warn'],
    [409, 'warn'],
    [429, 'warn'],
    [500, 'warn'],
    [503, 'warn'],
  ])('maps %i to %s', (status, level) => {
    expect(requestLogLevel(status)).toBe(level);
  });
});

describe('requestLoggingMiddleware', () => {
  afterEach(() => jest.restoreAllMocks());

  function run(
    url: string,
    status: number,
    headers: Record<string, string> = {},
    completed = true,
  ) {
    const response = Object.assign(new EventEmitter(), {
      statusCode: status,
      writableFinished: completed,
    }) as unknown as Response;
    const request = {
      method: 'GET',
      originalUrl: url,
      ip: '172.18.0.3',
      headers,
    } as unknown as Request;
    const next = jest.fn() as NextFunction;
    requestLoggingMiddleware(request, response, next);
    expect(next).toHaveBeenCalled();
    (response as unknown as EventEmitter).emit('close');
  }

  it('logs the path without the query string', () => {
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    run('/api/oidc/callback?code=secret&state=abc', 200);
    const line = String(debug.mock.calls[0][0]);
    expect(line).toMatch(
      /^GET \/api\/oidc\/callback 200 [\d.]+ms 172\.18\.0\.3$/,
    );
    expect(line).not.toContain('secret');
  });

  it('warns on server errors and shows the forwarded address', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    run('/api/login', 500, { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
    expect(String(warn.mock.calls[0][0])).toMatch(
      /^GET \/api\/login 500 [\d.]+ms 172\.18\.0\.3 fwd=203\.0\.113\.7$/,
    );
  });

  it('logs requests the client aborted at debug without a status', () => {
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    run('/api/devices', 500, {}, false);
    expect(warn).not.toHaveBeenCalled();
    expect(String(debug.mock.calls[0][0])).toMatch(
      /^GET \/api\/devices aborted [\d.]+ms 172\.18\.0\.3$/,
    );
  });
});
