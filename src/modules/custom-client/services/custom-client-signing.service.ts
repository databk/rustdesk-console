import { Injectable } from '@nestjs/common';
import { createPrivateKey, sign } from 'crypto';
import { CustomClientSettingsService } from './custom-client-settings.service';
import { CustomClientCustomDto } from '../dto/custom-client-build.dto';

@Injectable()
export class CustomClientSigningService {
  constructor(private readonly settingsService: CustomClientSettingsService) {}

  async generateSignedCustomTxt(
    custom: CustomClientCustomDto | undefined,
  ): Promise<string> {
    const { privateKey } = await this.settingsService.getSigningKeys();

    const config: Record<string, unknown> = {};
    if (custom) {
      if (custom['app-name']) {
        config['app-name'] = custom['app-name'];
      }
      if (custom.password) {
        config['password'] = custom.password;
      }
      if (custom.salt) {
        config['salt'] = custom.salt;
      }
      if (custom['conn-type']) {
        config['conn-type'] = custom['conn-type'];
      }
      if (custom['disable-installation']) {
        config['disable-installation'] = custom['disable-installation'];
      }
      if (custom['disable-settings']) {
        config['disable-settings'] = custom['disable-settings'];
      }
      if (custom['disable-account']) {
        config['disable-account'] = custom['disable-account'];
      }
      if (custom['disable-ab']) {
        config['disable-ab'] = custom['disable-ab'];
      }
      if (custom['disable-tcp-listen']) {
        config['disable-tcp-listen'] = custom['disable-tcp-listen'];
      }
      if (custom['override-settings']) {
        config['override-settings'] = custom['override-settings'];
      }
      if (custom['default-settings']) {
        config['default-settings'] = custom['default-settings'];
      }
    }

    const message = Buffer.from(JSON.stringify(config));
    const keyObject = createPrivateKey({
      key: Buffer.from(privateKey, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    const signature = sign(null, message, keyObject);
    const signedMessage = Buffer.concat([signature, message]);
    return signedMessage.toString('base64');
  }

  async getPublicKeyBase64(): Promise<string> {
    const { publicKey } = await this.settingsService.getSigningKeys();
    return publicKey;
  }
}
