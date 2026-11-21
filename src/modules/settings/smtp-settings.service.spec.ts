import 'reflect-metadata';
import * as nodemailer from 'nodemailer';
import { DataSource } from 'typeorm';
import { SystemSetting } from './entities/system-setting.entity';
import { SmtpSettingsService } from './services/smtp-settings.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const createTransport = nodemailer.createTransport as jest.Mock;

describe('SmtpSettingsService.testSmtpConnection', () => {
  let dataSource: DataSource;
  let service: SmtpSettingsService;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      dropSchema: true,
      synchronize: true,
      logging: false,
      entities: [SystemSetting],
    });
    await dataSource.initialize();
    service = new SmtpSettingsService(dataSource.getRepository(SystemSetting));
    createTransport.mockReset();
    createTransport.mockReturnValue({
      verify: jest.fn().mockResolvedValue(true),
      close: jest.fn(),
    });
    await service.updateSmtpConfig({
      host: 'mail.example.com',
      port: 465,
      secure: true,
      user: 'console@example.com',
      pass: 'saved-secret',
      from: 'console@example.com',
    });
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  function testedAuth(): unknown {
    const options = createTransport.mock.calls[0][0] as { auth?: unknown };
    return options.auth;
  }

  it('reuses the saved password when the form omits the masked password', async () => {
    await service.testSmtpConnection({
      host: 'mail.example.com',
      port: 587,
      secure: false,
      user: 'console@example.com',
    });

    expect(testedAuth()).toEqual({
      user: 'console@example.com',
      pass: 'saved-secret',
    });
  });

  it('treats the masked placeholder as the saved password', async () => {
    await service.testSmtpConnection({
      host: 'mail.example.com',
      user: 'console@example.com',
      pass: '******',
    });

    expect(testedAuth()).toEqual({
      user: 'console@example.com',
      pass: 'saved-secret',
    });
  });

  it('prefers a newly entered password', async () => {
    await service.testSmtpConnection({
      host: 'mail.example.com',
      user: 'console@example.com',
      pass: 'new-secret',
    });

    expect(testedAuth()).toEqual({
      user: 'console@example.com',
      pass: 'new-secret',
    });
  });

  it.each([
    ['host', { host: 'other.example.com', user: 'console@example.com' }],
    ['user', { host: 'mail.example.com', user: 'other@example.com' }],
  ])(
    'never sends the saved password when the %s differs',
    async (_field, dto) => {
      await service.testSmtpConnection(dto);

      expect(testedAuth()).toEqual({ user: dto.user, pass: undefined });
    },
  );

  it('tests the saved configuration when no form values are sent', async () => {
    await service.testSmtpConnection();

    expect(createTransport).toHaveBeenCalledWith({
      host: 'mail.example.com',
      port: 465,
      secure: true,
      auth: { user: 'console@example.com', pass: 'saved-secret' },
    });
  });
});
