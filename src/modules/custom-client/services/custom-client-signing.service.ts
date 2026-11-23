import { Injectable } from '@nestjs/common';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  type KeyObject,
} from 'crypto';
import { CustomClientSettingsService } from './custom-client-settings.service';
import { CustomClientCustomDto } from '../dto/custom-client-build.dto';

const ED25519_PKCS8_HEADER = Buffer.from(
  '302e020100300506032b657004220420',
  'hex',
);

// RustDesk 预设密码规则：salt 为空时按明文比对；salt 非空时必须存
// "00" + base64(SHA-256(password + salt))，否则客户端会判定为无可用预设密码。
// 控制台前端会自动生成盐并提交明文密码，这里统一转成客户端要求的哈希格式。
const PRESET_PASSWORD_HASH_RE = /^00[A-Za-z0-9+/]{43}=$/;

function normalizePresetPassword(password: string, salt?: string): string {
  if (!salt || PRESET_PASSWORD_HASH_RE.test(password)) {
    return password;
  }
  const h1 = createHash('sha256').update(password + salt, 'utf8').digest();
  return '00' + h1.toString('base64');
}

function createEd25519PrivateKey(privateKeyBase64: string): KeyObject {
  const rawKey = Buffer.from(privateKeyBase64, 'base64');
  if (rawKey.length === 32) {
    return createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_HEADER, rawKey]),
      format: 'der',
      type: 'pkcs8',
    });
  }
  return createPrivateKey({ key: rawKey, format: 'der', type: 'pkcs8' });
}

@Injectable()
export class CustomClientSigningService {
  constructor(private readonly settingsService: CustomClientSettingsService) {}

  async generateSignedCustomTxt(
    custom: CustomClientCustomDto | undefined,
  ): Promise<string> {
    const privateKey = await this.settingsService.getSigningPrivateKey();

    const config: Record<string, unknown> = {};
    if (custom) {
      if (custom['app-name']) {
        config['app-name'] = custom['app-name'];
      }
      if (custom.password) {
        config['password'] = normalizePresetPassword(
          custom.password,
          custom.salt,
        );
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
    const keyObject = createEd25519PrivateKey(privateKey);
    const signature = sign(null, message, keyObject);
    const signedMessage = Buffer.concat([signature, message]);
    return signedMessage.toString('base64');
  }

  async getPublicKeyBase64(): Promise<string> {
    const privateKey = await this.settingsService.getSigningPrivateKey();
    const keyObject = createEd25519PrivateKey(privateKey);
    const pubKeyObj = createPublicKey(keyObject);
    const pubDer = pubKeyObj.export({ type: 'spki', format: 'der' });
    return pubDer.subarray(-32).toString('base64');
  }
}
