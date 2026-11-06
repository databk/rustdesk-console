import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OidcAuthRequestDto } from './oidc.dto';

const validationOptions = { whitelist: true, forbidNonWhitelisted: true };

const clientRequest = {
  op: 'Zitadel',
  id: '123456789',
  uuid: 'ZGV2aWNlLXV1aWQ=',
  deviceInfo: { os: 'windows', type: 'client', name: 'desktop' },
};

describe('OidcAuthRequestDto', () => {
  it('accepts the apiDomain field sent by recent RustDesk clients', async () => {
    const dto = plainToInstance(OidcAuthRequestDto, {
      ...clientRequest,
      apiDomain: 'https://rustdesk.example.com',
    });

    expect(await validate(dto, validationOptions)).toHaveLength(0);
  });

  it('accepts client requests without apiDomain', async () => {
    const dto = plainToInstance(OidcAuthRequestDto, clientRequest);

    expect(await validate(dto, validationOptions)).toHaveLength(0);
  });

  it('rejects a non-string apiDomain', async () => {
    const dto = plainToInstance(OidcAuthRequestDto, {
      ...clientRequest,
      apiDomain: 42,
    });

    const errors = await validate(dto, validationOptions);
    expect(errors.map((error) => error.property)).toEqual(['apiDomain']);
  });

  it('still rejects unknown fields', async () => {
    const dto = plainToInstance(OidcAuthRequestDto, {
      ...clientRequest,
      unexpected: true,
    });

    const errors = await validate(dto, validationOptions);
    expect(errors.map((error) => error.property)).toEqual(['unexpected']);
  });
});
