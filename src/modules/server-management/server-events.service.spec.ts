import { ConfigService } from '@nestjs/config';
import {
  extractServerEvents,
  ServerEventsService,
  type ServerEvent,
} from './server-events.service';

const base = {
  HBBS_MANAGEMENT_URL: 'http://hbbs:21120',
  SERVER_MANAGEMENT_TOKEN: 'a'.repeat(40),
};

describe('server event stream', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('parses complete frames, ignores keep-alives and tolerates malformed data', () => {
    const input =
      ': keep-alive\n\n' +
      'event: relay_registered\ndata: {"kind":"relay_registered","timestamp":"t","data":{"id":"relay-a","address":"relay-a:21117","generation":1}}\n\n' +
      'event: broken\ndata: not-json\n\n' +
      'data: {"kind":"peer_online","data":{"id":"123456789"}}\n\n';
    const { events, remainder } = extractServerEvents(input, '');
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      kind: 'relay_registered',
      data: { id: 'relay-a', address: 'relay-a:21117', generation: 1 },
    });
    expect(events[1]).toEqual({
      kind: 'peer_online',
      data: { id: '123456789' },
    });
    expect(remainder).toBe('');
  });

  it('keeps partial frames for the next chunk', () => {
    const first = extractServerEvents(
      'event: session_closed\ndata: {"kind":"session_closed","data":{"uuid":"u1"}}',
      '',
    );
    expect(first.events).toHaveLength(0);
    const second = extractServerEvents('\n\n', first.remainder);
    expect(second.events).toEqual([
      { kind: 'session_closed', data: { uuid: 'u1' } },
    ]);
  });

  it('maintains the live relay and session view', () => {
    const service = new ServerEventsService(new ConfigService(base));
    expect(service.isFresh()).toBe(false);
    const apply = (event: ServerEvent) => service.applyEvent(event);
    apply({
      kind: 'session_opened',
      data: {
        uuid: 'u1',
        relay_id: 'relay-a',
        session: { uuid: 'u1', bytes: 10 },
      },
    });
    apply({
      kind: 'session_opened',
      data: { uuid: 'u2', relay_id: 'relay-b', session: { uuid: 'u2' } },
    });
    expect(service.getSessions()).toHaveLength(2);
    expect(service.getSessionRelay('u1')).toBe('relay-a');
    expect(service.hasRelay('relay-a')).toBe(false);
    apply({ kind: 'relay_registered', data: { id: 'relay-a' } });
    expect(service.hasRelay('relay-a')).toBe(true);
    apply({ kind: 'session_closed', data: { uuid: 'u2' } });
    expect(service.getSessions()).toHaveLength(1);
    apply({ kind: 'relay_disconnected', data: { id: 'relay-a' } });
    expect(service.hasRelay('relay-a')).toBe(false);
    expect(service.getSessions()).toHaveLength(0);
    expect(service.getSessionRelay('u1')).toBeUndefined();
    expect(service.isFresh()).toBe(true);
  });

  it('ignores malformed event payloads', () => {
    const service = new ServerEventsService(new ConfigService(base));
    service.applyEvent({ kind: 'session_opened', data: {} });
    service.applyEvent({ kind: 'session_opened', data: { uuid: 'u1' } });
    service.applyEvent({ kind: 'session_closed', data: {} });
    service.applyEvent({ kind: 'relay_registered', data: {} });
    service.applyEvent({ kind: 'unknown', data: { id: 'x' } });
    expect(service.getSessions()).toHaveLength(0);
    expect(service.isFresh()).toBe(true);
  });

  it('stays inert when the upstream is not configured', () => {
    const service = new ServerEventsService(new ConfigService({}));
    expect(() => service.onModuleInit()).not.toThrow();
    expect(service.isFresh()).toBe(false);
    expect(service.getSessions()).toHaveLength(0);
  });

  it('stays inert when the token is too short', () => {
    const service = new ServerEventsService(
      new ConfigService({
        HBBS_MANAGEMENT_URL: base.HBBS_MANAGEMENT_URL,
        SERVER_MANAGEMENT_TOKEN: 'short',
      }),
    );
    expect(() => service.onModuleInit()).not.toThrow();
    expect(service.isFresh()).toBe(false);
  });
});
