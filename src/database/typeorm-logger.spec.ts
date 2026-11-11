import { Logger } from '@nestjs/common';
import type { Logger as TypeOrmLogger } from 'typeorm';
import {
  redactDriverMessage,
  resolveDbLogMode,
  resolveSlowQueryMs,
  TypeOrmNestLogger,
} from './typeorm-logger';

describe('resolveDbLogMode', () => {
  it.each([
    [undefined, 'errors'],
    ['', 'errors'],
    ['nonsense', 'errors'],
    ['off', 'off'],
    ['FALSE', 'off'],
    ['queries', 'queries'],
    [' all ', 'queries'],
  ])('maps %p to %s', (value, mode) => {
    expect(resolveDbLogMode(value)).toBe(mode);
  });
});

describe('resolveSlowQueryMs', () => {
  it.each([
    [undefined, 1000],
    ['', 1000],
    ['nonsense', 1000],
    ['-5', 1000],
    ['250', 250],
    [' 2000 ', 2000],
    ['0', undefined],
  ])('maps %p to %p', (value, expected) => {
    expect(resolveSlowQueryMs(value)).toBe(expected);
  });
});

describe('redactDriverMessage', () => {
  it('removes quoted values from driver messages', () => {
    expect(
      redactDriverMessage(
        "Duplicate entry 'alice@example.com' for key 'users.IDX_email'",
      ),
    ).toBe("Duplicate entry '?' for key 'users.IDX_email'");
    expect(
      redactDriverMessage(
        "Incorrect string value: 'it''s secret' for column 'note' at row 1",
      ),
    ).toBe("Incorrect string value: '?' for column 'note' at row 1");
  });

  it('leaves other messages unchanged', () => {
    const message = 'SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email';
    expect(redactDriverMessage(message)).toBe(message);
  });
});

describe('TypeOrmNestLogger', () => {
  let debug: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('never logs query parameters', () => {
    const logger = new TypeOrmNestLogger('queries');
    logger.logQueryError(
      new Error('no such table: user'),
      'INSERT INTO user (name, password) VALUES (?, ?)',
    );
    expect(warn).toHaveBeenCalledWith(
      'Query failed: no such table: user | INSERT INTO user (name, password) VALUES (?, ?)',
    );
    // TypeORM passes parameters as a second argument; they must be ignored.
    const asTypeOrm: TypeOrmLogger = logger;
    asTypeOrm.logQuery('SELECT 1', ['hash-value']);
    expect(String(debug.mock.calls[0][0])).not.toContain('hash-value');
  });

  it('logs unique conflicts at debug with the value redacted', () => {
    const error = Object.assign(
      new Error("Duplicate entry 'alice@example.com' for key 'users.email'"),
      { code: 'ER_DUP_ENTRY' },
    );
    new TypeOrmNestLogger('errors').logQueryError(error, 'INSERT INTO users');
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      "Query failed: Duplicate entry '?' for key 'users.email' | INSERT INTO users",
    );
  });

  it('only logs statements in queries mode', () => {
    new TypeOrmNestLogger('errors').logQuery('SELECT 1');
    expect(debug).not.toHaveBeenCalled();
    new TypeOrmNestLogger('queries').logQuery('SELECT\n  1');
    expect(debug).toHaveBeenCalledWith('SELECT 1');
  });

  it('is silent when off', () => {
    const logger = new TypeOrmNestLogger('off');
    logger.logQueryError('boom', 'SELECT 1');
    logger.logQuerySlow(5000, 'SELECT 1');
    logger.log('warn', 'something');
    expect(warn).not.toHaveBeenCalled();
  });
});
