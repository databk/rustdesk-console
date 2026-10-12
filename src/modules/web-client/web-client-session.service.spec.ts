import 'reflect-metadata';
import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClientService } from './web-client.service';
import { WebClientAuthorizationService } from './web-client-authorization.service';
import { WebClientSessionService } from './web-client-session.service';
import { RbacAuditService } from '../rbac/services/rbac-audit.service';
import {
  WebClientEventDto,
  WebClientSessionDto,
  WebClientEmptyBodyPipe,
} from './dto/web-client.dto';

jest.mock('uuid', () => ({
  v4: jest.requireActual<typeof import('node:crypto')>('node:crypto')
    .randomUUID,
}));

describe('WebClientSessionService 票据、撤权和来源审计', () => {
  let service: WebClientSessionService;
  let configuration: Record<string, string>;
  let authorization: { validate: jest.Mock; requireDisconnect: jest.Mock };
  let audit: { record: jest.Mock };
  const actor = { id: 'operator', jti: 'session-jti' };

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-10T00:00:00Z') });
    configuration = {
      WEB_CLIENT_ENABLED: 'true',
      WEB_CLIENT_ALLOWED_ORIGIN: 'https://console.example.com',
      WEB_CLIENT_ID_SERVER_URL: 'wss://console.example.com/ws/id',
      WEB_CLIENT_RELAY_SERVER_URL: 'wss://console.example.com/ws/relay',
      WEB_CLIENT_SERVER_PUBLIC_KEY: Buffer.alloc(32, 7).toString('base64'),
    };
    const config = new WebClientService({
      get: (key: string) => configuration[key],
    } as ConfigService);
    authorization = {
      validate: jest.fn().mockImplementation(() => ({
        peer: { uuid: 'peer-1' },
        expiresAt: Date.now() + 3_600_000,
      })),
      requireDisconnect: jest.fn().mockResolvedValue(undefined),
    };
    audit = { record: jest.fn().mockResolvedValue({}) };
    service = new WebClientSessionService(
      authorization as unknown as WebClientAuthorizationService,
      config,
      audit as unknown as RbacAuditService,
    );
  });
  afterEach(async () => {
    await service.onModuleDestroy();
    jest.useRealTimers();
  });

  async function open() {
    const grant = await service.create(actor, '123456789');
    const rendezvous = await service.consumeTicket(grant.tickets.rendezvous);
    expect(rendezvous).toMatchObject({
      sessionGuid: grant.sessionGuid,
      targetId: '123456789',
      kind: 'desktop',
      phase: 'rendezvous',
    });
    service.bindRelay(
      grant.sessionGuid,
      'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    );
    await service.consumeTicket(grant.tickets.relay);
    await service.markRelayOpen(grant.sessionGuid);
    return grant;
  }

  it('连接监测仅允许当前登录自己的已建立桌面会话，并即时复验权限', async () => {
    const grant = await open();
    await expect(
      service.requireOwnedActive(actor, grant.sessionGuid),
    ).resolves.toBeUndefined();
    for (const other of [
      { ...actor, id: 'another' },
      { ...actor, jti: 'another-login' },
    ])
      await expect(
        service.requireOwnedActive(other, grant.sessionGuid),
      ).rejects.toBeInstanceOf(ForbiddenException);
    authorization.validate.mockRejectedValueOnce(
      new ForbiddenException('Revoked'),
    );
    await expect(
      service.requireOwnedActive(actor, grant.sessionGuid),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.requireOwnedActive(actor, grant.sessionGuid),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('未建立的会话无法读取连接算法', async () => {
    const grant = await service.create(actor, '123456789');
    await expect(
      service.requireOwnedActive(actor, grant.sessionGuid),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('票据先原子消费再校验，两个同时消费最多一个成功且不记录秘密', async () => {
    const grant = await service.create(actor, ' 123 456 789 ');
    const results = await Promise.allSettled([
      service.consumeTicket(grant.tickets.rendezvous),
      service.consumeTicket(grant.tickets.rendezvous),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    await expect(service.consumeTicket(grant.tickets.relay)).rejects.toThrow(
      'Relay has not been bound',
    );
    const serialized = JSON.stringify(audit.record.mock.calls);
    expect(serialized).not.toContain(grant.tickets.relay);
    expect(serialized).not.toContain(grant.tickets.rendezvous);
    expect(serialized).not.toContain(actor.jti);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'web_client.request_allowed',
        actorUserGuid: actor.id,
        requestId: grant.sessionGuid,
        afterState: expect.objectContaining({
          source: 'server',
          targetId: '123456789',
        }),
      }),
    );
  });

  it('60 秒票据过期，120 秒未建立中继回收，结束只记一次', async () => {
    const grant = await service.create(actor, '123456789');
    const close = jest.fn();
    service.attach(grant.sessionGuid, close);
    jest.advanceTimersByTime(60_001);
    await expect(
      service.consumeTicket(grant.tickets.rendezvous),
    ).rejects.toThrow('expired');
    jest.advanceTimersByTime(60_000);
    await service.revalidateSessions();
    await service.closeGrant(grant.sessionGuid, 'pending_expired');
    expect(close).toHaveBeenCalledTimes(1);
    expect(
      audit.record.mock.calls.filter(
        ([event]) => event.action === 'web_client.session_ended',
      ),
    ).toHaveLength(1);
  });

  it('准许日志不可用时不给可消费授权', async () => {
    audit.record.mockRejectedValue(
      new Error('database unavailable secret=not-for-log'),
    );
    await expect(service.create(actor, '123456789')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(
      (service as unknown as { sessions: Map<string, unknown> }).sessions.size,
    ).toBe(0);
  });

  it('准许日志等待期间取消应用，迟到结果不重开会话', async () => {
    let resolveAudit!: () => void;
    audit.record.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveAudit = resolve;
        }),
    );
    const creating = service.create(actor, '123456789');
    await jest.advanceTimersByTimeAsync(0);
    await service.onModuleDestroy();
    resolveAudit();
    await expect(creating).rejects.toThrow('no longer available');
  });

  it('单账号并发创建限额也计算等待 DB 的申请', async () => {
    let resolveValidation!: (value: unknown) => void;
    const validation = new Promise((resolve) => {
      resolveValidation = resolve;
    });
    authorization.validate.mockReturnValue(validation);
    const pending = Array.from({ length: 8 }, () =>
      service.create(actor, '123456789'),
    );
    await expect(service.create(actor, '123456789')).rejects.toMatchObject({
      status: 429,
    });
    resolveValidation({
      peer: { uuid: 'peer-1' },
      expiresAt: Date.now() + 3_600_000,
    });
    await Promise.all(pending);
  });

  it('消费校验等待期间 grant 关闭，迟到 claim 不能重新使用', async () => {
    const grant = await service.create(actor, '123456789');
    let resolveValidation!: (value: unknown) => void;
    authorization.validate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveValidation = resolve;
        }),
    );
    const claim = service.consumeTicket(grant.tickets.rendezvous);
    await service.closeGrant(grant.sessionGuid, 'cancelled');
    resolveValidation({
      peer: { uuid: 'peer-1' },
      expiresAt: Date.now() + 3_600_000,
    });
    await expect(claim).rejects.toBeInstanceOf(ForbiddenException);
    expect(() => service.attach(grant.sessionGuid, jest.fn())).toThrow();
  });

  it('不同账号仍共享256授权全局上限，关闭后释放额度', async () => {
    let first!: Awaited<ReturnType<typeof service.create>>;
    for (let index = 0; index < 256; index++) {
      const grant = await service.create(
        { id: `user-${Math.floor(index / 8)}`, jti: `login-${index}` },
        '123456789',
      );
      if (!index) first = grant;
    }
    await expect(
      service.create({ id: 'another-user', jti: 'another-login' }, '123456789'),
    ).rejects.toMatchObject({ status: 429 });
    await service.closeGrant(first.sessionGuid, 'cancelled');
    await expect(
      service.create({ id: 'another-user', jti: 'another-login' }, '123456789'),
    ).resolves.toMatchObject({ gatewayPath: '/api/web-client/socket' });
  });

  it('活跃授权不超过8小时，且被登录 token 的期限进一步收紧', async () => {
    authorization.validate.mockResolvedValue({
      peer: { uuid: 'peer-1' },
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    const grant = await service.create(actor, '123456789');
    expect(Date.parse(grant.expiresAt) - Date.now()).toBe(8 * 60 * 60 * 1000);
    service.bindRelay(
      grant.sessionGuid,
      'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    );
    await service.markRelayOpen(grant.sessionGuid);
    const close = jest.fn();
    service.attach(grant.sessionGuid, close);
    authorization.validate.mockResolvedValue({
      peer: { uuid: 'peer-1' },
      expiresAt: Date.now() + 1000,
    });
    await service.ensureValid(grant.sessionGuid);
    jest.advanceTimersByTime(1001);
    await service.revalidateSessions();
    expect(close).toHaveBeenCalledWith('expired');
  });

  it.each(['role', 'token', 'configuration', 'upstream', 'origin'] as const)(
    '活跃会话因 %s 变化从服务端关闭，鉴权异常 fail closed',
    async (reason) => {
      const grant = await open();
      const close = jest.fn();
      service.attach(grant.sessionGuid, close);
      if (reason === 'role')
        authorization.validate.mockRejectedValue(new ForbiddenException());
      if (reason === 'token')
        authorization.validate.mockRejectedValue(new UnauthorizedException());
      if (reason === 'configuration')
        configuration.WEB_CLIENT_ENABLED = 'false';
      if (reason === 'upstream')
        configuration.WEB_CLIENT_ID_UPSTREAM_URL = 'ws://another-hbbs:21118';
      if (reason === 'origin')
        configuration.WEB_CLIENT_ALLOWED_ORIGIN = 'https://other.example.com';
      await service.revalidateSessions();
      expect(close).toHaveBeenCalledWith(
        reason === 'token' ? 'authentication_revoked' : 'authorization_revoked',
      );
      await expect(
        service.consumeTicket(grant.tickets.relay),
      ).rejects.toThrow();
    },
  );

  it('父桌面关闭同步结束文件子会话，不能跨操作者申请或借文件再次派生', async () => {
    const parent = await open();
    await expect(
      service.createFile(
        { id: 'someone-else', jti: 'other' },
        parent.sessionGuid,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const files = await service.createFile(actor, parent.sessionGuid);
    await expect(
      service.createFile(actor, files.sessionGuid),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const close = jest.fn();
    service.attach(files.sessionGuid, close);
    await service.end(actor, parent.sessionGuid);
    expect(close).toHaveBeenCalledWith('parent_closed');
    await expect(
      service.consumeTicket(files.tickets.rendezvous),
    ).rejects.toThrow();
    expect(
      audit.record.mock.calls.filter(
        ([event]) => event.action === 'web_client.session_ended',
      ),
    ).toHaveLength(2);
  });

  it('慢审计不能拖延任何子文件通道的立即关闭', async () => {
    const parent = await open();
    const first = await service.createFile(actor, parent.sessionGuid);
    const second = await service.createFile(actor, parent.sessionGuid);
    const callbacks = [jest.fn(), jest.fn(), jest.fn()];
    service.attach(parent.sessionGuid, callbacks[0]);
    service.attach(first.sessionGuid, callbacks[1]);
    service.attach(second.sessionGuid, callbacks[2]);
    let resolveAudit!: () => void;
    audit.record.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveAudit = resolve;
        }),
    );
    const ending = service.end(actor, parent.sessionGuid);
    expect(callbacks[0]).toHaveBeenCalledWith('cancelled');
    expect(callbacks[1]).toHaveBeenCalledWith('parent_closed');
    expect(callbacks[2]).toHaveBeenCalledWith('parent_closed');
    await jest.advanceTimersByTimeAsync(0);
    resolveAudit();
    await ending;
  });

  it('挂起的数据库复验5秒后关闭全部通道，底层返回只解除健康门禁，不复活旧grant', async () => {
    const parent = await open();
    const child = await service.createFile(actor, parent.sessionGuid);
    const independent = await service.create(
      { id: 'another-actor', jti: 'another-login' },
      '987654321',
    );
    const closes = [jest.fn(), jest.fn(), jest.fn()];
    service.attach(parent.sessionGuid, closes[0]);
    service.attach(child.sessionGuid, closes[1]);
    service.attach(independent.sessionGuid, closes[2]);
    let resolveValidation!: (value: unknown) => void;
    authorization.validate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveValidation = resolve;
        }),
    );
    const checking = service.revalidateSessions();
    await jest.advanceTimersByTimeAsync(4999);
    expect(closes.every((close) => close.mock.calls.length === 0)).toBe(true);
    await jest.advanceTimersByTimeAsync(1);
    await checking;
    for (const close of closes)
      expect(close).toHaveBeenCalledWith('verification_timeout');
    await expect(service.create(actor, '123456789')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    resolveValidation({
      peer: { uuid: 'peer-1' },
      expiresAt: Date.now() + 3_600_000,
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(() => service.attach(parent.sessionGuid, jest.fn())).toThrow();
    await expect(service.create(actor, '123456789')).resolves.toMatchObject({
      gatewayPath: '/api/web-client/socket',
    });
  });

  it('整轮5秒总截止，多个4秒查询不能将队尾会话拖到下一轮之后', async () => {
    const first = await service.create(actor, '123456789');
    const second = await service.create(actor, '123456789');
    const third = await service.create(actor, '123456789');
    const closes = [jest.fn(), jest.fn(), jest.fn()];
    [first, second, third].forEach((grant, index) =>
      service.attach(grant.sessionGuid, closes[index]),
    );
    authorization.validate.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                peer: { uuid: 'peer-1' },
                expiresAt: Date.now() + 3_600_000,
              }),
            4000,
          ),
        ),
    );
    const checking = service.revalidateSessions();
    await jest.advanceTimersByTimeAsync(5000);
    await checking;
    for (const close of closes)
      expect(close).toHaveBeenCalledWith('verification_timeout');
    expect(authorization.validate.mock.calls.length).toBe(5); // 3次申请，仅前2条复验开始。
    await jest.advanceTimersByTimeAsync(3000);
    for (const grant of [first, second, third])
      expect(() => service.attach(grant.sessionGuid, jest.fn())).toThrow();
  });

  it('审计挂起也有5秒截止，不发新票据，全部旧连接关闭且迟到写入不能创建grant', async () => {
    const parent = await open();
    const close = jest.fn();
    service.attach(parent.sessionGuid, close);
    let resolveAudit!: () => void;
    audit.record.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveAudit = resolve;
        }),
    );
    const result = service.create(actor, '123456789').then(
      () => 'allowed',
      (error: unknown) => error,
    );
    await jest.advanceTimersByTimeAsync(5000);
    expect(await result).toBeInstanceOf(ServiceUnavailableException);
    expect(close).toHaveBeenCalledWith('verification_timeout');
    resolveAudit();
    await jest.advanceTimersByTimeAsync(0);
    expect(
      (service as unknown as { sessions: Map<string, unknown> }).sessions.size,
    ).toBe(0);
  });

  it('申请期间修改服务端公钥或上游配置，不能发与新配置不一致的旧授权', async () => {
    let resolveAudit!: () => void;
    audit.record.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveAudit = resolve;
        }),
    );
    const creating = service.create(actor, '123456789');
    await jest.advanceTimersByTimeAsync(0);
    configuration.WEB_CLIENT_SERVER_PUBLIC_KEY = Buffer.alloc(32, 8).toString(
      'base64',
    );
    resolveAudit();
    await expect(creating).rejects.toThrow('no longer available');
    expect(
      (service as unknown as { sessions: Map<string, unknown> }).sessions.size,
    ).toBe(0);
  });

  it('浏览器报告来源不可升级为 server，白名单元数据无 body、secret 或自由错误', async () => {
    const parent = await open();
    await service.report(actor, parent.sessionGuid, {
      event: 'remote_auth_succeeded',
    });
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'web_client.remote_auth_succeeded',
        result: 'allowed',
        afterState: expect.objectContaining({
          source: 'browser',
          targetId: '123456789',
        }),
      }),
    );
    await service.report(actor, parent.sessionGuid, {
      event: 'remote_auth_failed',
    });
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'web_client.remote_auth_failed',
        result: 'denied',
        afterState: expect.objectContaining({ source: 'browser' }),
      }),
    );
    await expect(
      service.report(actor, parent.sessionGuid, {
        event: 'file_started',
        fileName: 'x',
        size: 1,
        direction: 'upload',
      }),
    ).rejects.toThrow('metadata');
    await service.end(actor, parent.sessionGuid);
    await expect(
      service.report(actor, parent.sessionGuid, {
        event: 'remote_auth_succeeded',
      }),
    ).rejects.toThrow('unavailable');
  });

  it('浏览器事件限流且文件仅登记有限 basename/大小/方向', async () => {
    const parent = await open();
    const files = await service.createFile(actor, parent.sessionGuid);
    service.bindRelay(
      files.sessionGuid,
      'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    );
    await service.markRelayOpen(files.sessionGuid);
    for (let i = 0; i < 4; i++)
      await service.report(actor, files.sessionGuid, {
        event: 'file_started',
        fileName: 'report.txt',
        size: 123,
        direction: 'download',
      });
    await expect(
      service.report(actor, files.sessionGuid, {
        event: 'file_completed',
        fileName: 'report.txt',
        size: 123,
        direction: 'download',
      }),
    ).rejects.toMatchObject({ status: 429 });
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        afterState: expect.objectContaining({
          source: 'browser',
          fileName: 'report.txt',
          size: 123,
          direction: 'download',
        }),
      }),
    );
  });

  it('文件失败作为browser失败结果记录，不被写成allowed', async () => {
    const parent = await open();
    const files = await service.createFile(actor, parent.sessionGuid);
    service.bindRelay(
      files.sessionGuid,
      'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    );
    await service.markRelayOpen(files.sessionGuid);
    await service.report(actor, files.sessionGuid, {
      event: 'file_failed',
      fileName: 'report.txt',
      size: 123,
      direction: 'upload',
    });
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'web_client.file_failed',
        result: 'denied',
        afterState: expect.objectContaining({ source: 'browser' }),
      }),
    );
  });

  it('管理员断开按当前目标授权，实际关闭日志记执行管理员；结束后的重复请求不伪造日志', async () => {
    const grant = await open();
    const manager = { id: 'manager', jti: 'manager-login' };
    const close = jest.fn();
    service.attach(grant.sessionGuid, close);
    authorization.requireDisconnect.mockRejectedValueOnce(
      new ForbiddenException(),
    );
    await expect(
      service.end(manager, grant.sessionGuid),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(close).not.toHaveBeenCalled();
    await service.end(manager, grant.sessionGuid);
    expect(authorization.requireDisconnect).toHaveBeenCalledWith(
      manager,
      'peer-1',
    );
    expect(close).toHaveBeenCalledWith('admin_disconnect');
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        actorUserGuid: manager.id,
        action: 'web_client.session_ended',
        afterState: expect.objectContaining({
          source: 'server',
          reason: 'admin_disconnect',
          closedBy: manager.id,
        }),
      }),
    );
    const count = audit.record.mock.calls.length;
    await service.end(manager, grant.sessionGuid);
    expect(audit.record).toHaveBeenCalledTimes(count);
  });

  it('终止日志失败仍关闭通道，未知关闭理由不会成为任意文本日志', async () => {
    const grant = await open();
    const close = jest.fn();
    service.attach(grant.sessionGuid, close);
    audit.record.mockRejectedValueOnce(new Error('secret backend error'));
    await expect(
      service.closeGrant(grant.sessionGuid, 'raw-password'),
    ).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledWith('connection_closed');
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
      'raw-password',
    );
  });

  it('无效 ID 不记原始输入，合法越权 ID 记录申请目标', async () => {
    await expect(
      service.create(actor, 'https://host?token=secret'),
    ).rejects.toThrow();
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
      'token=secret',
    );
    authorization.validate.mockRejectedValue(new ForbiddenException());
    await expect(service.create(actor, ' 123 456 789 ')).rejects.toThrow();
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        result: 'denied',
        afterState: expect.objectContaining({
          targetId: '123456789',
          source: 'server',
        }),
      }),
    );
  });
});

describe('网页 HTTP DTO 强校验', () => {
  it('文件授权只允许没有body或空对象，数组/null/多余字段全部拒绝', () => {
    const empty = new WebClientEmptyBodyPipe();
    expect(empty.transform(undefined)).toBeUndefined();
    expect(empty.transform({})).toEqual({});
    for (const value of [
      null,
      [],
      [1],
      '',
      'body',
      1,
      false,
      { targetId: 'other' },
      { actor: 'owner' },
    ])
      expect(() => empty.transform(value)).toThrow();
  });
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  it('拒绝用户伪造 actor/source、自由错误正文和超大参数', async () => {
    for (const value of [
      { event: 'remote_auth_succeeded', source: 'server' },
      { event: 'remote_auth_failed', error: 'password' },
      {
        event: 'file_started',
        fileName: '../secret.txt',
        size: 1,
        direction: 'upload',
      },
      {
        event: 'file_started',
        fileName: 'x',
        size: 17 * 1024 ** 3,
        direction: 'upload',
      },
      { event: 'file_started', fileName: 'x', size: NaN, direction: 'upload' },
    ])
      await expect(
        pipe.transform(value, { type: 'body', metatype: WebClientEventDto }),
      ).rejects.toThrow();
    await expect(
      pipe.transform(
        { targetId: '123456789', actor: 'owner' },
        { type: 'body', metatype: WebClientSessionDto },
      ),
    ).rejects.toThrow();
  });
  it('接受正常 metadata 而不把字符串大小自动变数字', async () => {
    await expect(
      pipe.transform(
        {
          event: 'file_completed',
          fileName: '报告.png',
          size: 10,
          direction: 'download',
        },
        { type: 'body', metatype: WebClientEventDto },
      ),
    ).resolves.toMatchObject({ fileName: '报告.png', size: 10 });
    await expect(
      pipe.transform(
        {
          event: 'file_started',
          fileName: 'x',
          size: '10',
          direction: 'upload',
        },
        { type: 'body', metatype: WebClientEventDto },
      ),
    ).rejects.toThrow();
  });
});

describe('网关配置不可使用缺省或不可信来源', () => {
  const valid = {
    WEB_CLIENT_ENABLED: 'true',
    WEB_CLIENT_ALLOWED_ORIGIN: 'https://console.example.com',
    WEB_CLIENT_ID_SERVER_URL: 'wss://console.example.com/ws/id',
    WEB_CLIENT_RELAY_SERVER_URL: 'wss://console.example.com/ws/relay',
    WEB_CLIENT_SERVER_PUBLIC_KEY: Buffer.alloc(32, 7).toString('base64'),
  };
  const service = (values: Record<string, string | undefined>) =>
    new WebClientService({
      get: (key: string) => values[key],
    } as ConfigService);
  it('默认关闭，不暴露内部上游，启用时必须显式 HTTPS origin', () => {
    expect(service({}).getConfiguration()).toEqual({ enabled: false });
    expect(() =>
      service({
        ...valid,
        WEB_CLIENT_ALLOWED_ORIGIN: undefined,
      }).getConfiguration(),
    ).toThrow(ServiceUnavailableException);
    const internal = service({
      ...valid,
      WEB_CLIENT_ID_UPSTREAM_URL: 'ws://hbbs:21118',
    });
    expect(internal.getUpstream('rendezvous')).toBe('ws://hbbs:21118');
    expect(JSON.stringify(internal.getConfiguration())).not.toContain(
      'hbbs:21118',
    );
  });
  it.each([
    'http://console.example.com',
    'https://console.example.com/',
    'https://user@console.example.com',
    'https://console.example.com?token=x',
  ])('拒绝不精确或非HTTPS origin %s', (origin) => {
    expect(() =>
      service({
        ...valid,
        WEB_CLIENT_ALLOWED_ORIGIN: origin,
      }).getConfiguration(),
    ).toThrow();
  });
  it.each([
    'https://hbbs',
    'ws://user:secret@hbbs:21118',
    'ws://hbbs:21118?token=secret',
    ' ws://hbbs:21118',
  ])('拒绝危险内部 URL %s', (url) => {
    expect(() =>
      service({ ...valid, WEB_CLIENT_ID_UPSTREAM_URL: url }).getConfiguration(),
    ).toThrow();
  });
});
