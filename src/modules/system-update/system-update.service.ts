import { HttpException, Injectable } from '@nestjs/common';
import { request } from 'node:http';
import type {
  Capabilities,
  CreateJobRequest,
  CreateJobResponse,
  CurrentJobResponse,
  JobView,
  UpdatePlan,
} from '../../updater/contracts';
import { safeError, UpdateError } from '../../updater/errors';
type Operation = 'capabilities' | 'plans' | 'jobs' | 'current' | 'job';
export function ipcRequest<T>(
  operation: Operation,
  body: unknown = {},
  actorId?: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const serialized = JSON.stringify({ operation, body, actorId });
    const req = request(
      {
        socketPath:
          process.env.SYSTEM_UPDATE_SOCKET ??
          '/run/rustdesk-console-updater/control.sock',
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(serialized),
        },
        timeout: 180_000,
      },
      (response) => {
        let text = '';
        response.on('data', (chunk: Buffer) => {
          text += chunk.toString('utf8');
          if (text.length > 2 * 1024 * 1024)
            req.destroy(
              new UpdateError(
                'IPC_INVALID',
                'The updater returned an invalid response.',
                503,
              ),
            );
        });
        response.on('end', () => {
          try {
            const value = JSON.parse(text) as T & {
              code?: string;
              message?: string;
            };
            if ((response.statusCode ?? 503) >= 400)
              reject(
                new UpdateError(
                  value.code ?? 'UPDATER_UNAVAILABLE',
                  value.message ?? 'The updater is unavailable.',
                  response.statusCode,
                ),
              );
            else resolve(value);
          } catch {
            reject(
              new UpdateError(
                'IPC_INVALID',
                'The updater returned an invalid response.',
                503,
              ),
            );
          }
        });
      },
    );
    req.on('timeout', () =>
      req.destroy(
        new UpdateError(
          'UPDATER_TIMEOUT',
          'The updater is temporarily unavailable. Retry the same task request.',
          503,
        ),
      ),
    );
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT')
        reject(
          new UpdateError(
            'HELPER_NOT_INSTALLED',
            'The update helper is not installed. Follow the official managed-deployment migration instructions.',
            503,
          ),
        );
      else
        reject(
          error instanceof UpdateError
            ? error
            : new UpdateError(
                'HELPER_UNAVAILABLE',
                'The installed updater is temporarily unavailable. Check the host service.',
                503,
              ),
        );
    });
    req.end(serialized);
  });
}
@Injectable()
export class SystemUpdateService {
  async capabilities(): Promise<Capabilities> {
    try {
      return await ipcRequest<Capabilities>('capabilities');
    } catch (error) {
      const safe = safeError(error);
      if (safe.code === 'HELPER_NOT_INSTALLED')
        return {
          protocolVersion: 1,
          installationId: null,
          supported: false,
          ready: false,
          deployment: null,
          database: null,
          current: null,
          blockers: [safe.blocker()],
          activeJobId: null,
        };
      throw new HttpException(
        { code: safe.code, message: safe.message },
        safe.status,
      );
    }
  }
  async call<T>(
    operation: Operation,
    body?: unknown,
    actorId?: string,
  ): Promise<T> {
    try {
      return await ipcRequest<T>(operation, body, actorId);
    } catch (error) {
      const safe = safeError(error);
      throw new HttpException(
        { code: safe.code, message: safe.message },
        safe.status,
      );
    }
  }
  plan(actorId: string): Promise<UpdatePlan> {
    return this.call('plans', {}, actorId);
  }
  create(body: CreateJobRequest, actorId: string): Promise<CreateJobResponse> {
    return this.call('jobs', body, actorId);
  }
  current(): Promise<CurrentJobResponse> {
    return this.call('current');
  }
  job(id: string): Promise<JobView> {
    return this.call('job', { id });
  }
}
