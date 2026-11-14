import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
} from 'crypto';
import { SystemSetting } from '../../settings/entities/system-setting.entity';
import {
  UpdateCustomClientSettingsDto,
  CustomClientSettingsResponse,
} from '../dto/custom-client-settings.dto';

const CATEGORY = 'custom-client';
const GITHUB_TOKEN_KEY = 'custom-client.github-token';
const GENERATOR_REPO_KEY = 'custom-client.generator-repo';
const GENERATOR_REF_KEY = 'custom-client.generator-ref';
const SIGNING_PRIVATE_KEY = 'custom-client.signing-private-key';
const DEFAULT_GENERATOR_REPO = 'databk/rustdesk-generator';
const DEFAULT_GENERATOR_REF = 'main';
const TOKEN_MASK = '******';

const ED25519_PKCS8_HEADER = Buffer.from(
  '302e020100300506032b657004220420',
  'hex',
);

function generateEd25519PrivateKey(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  return privDer.toString('base64');
}

function createEd25519PrivateKey(privateKeyBase64: string): KeyObject {
  const rawKey = Buffer.from(privateKeyBase64, 'base64');
  if (rawKey.length === 48) {
    return createPrivateKey({ key: rawKey, format: 'der', type: 'pkcs8' });
  }
  if (rawKey.length === 32) {
    return createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_HEADER, rawKey]),
      format: 'der',
      type: 'pkcs8',
    });
  }
  return createPrivateKey({ key: rawKey, format: 'der', type: 'pkcs8' });
}

function derivePublicKeyBase64(privateKeyBase64: string): string {
  const keyObject = createEd25519PrivateKey(privateKeyBase64);
  const pubKeyObj = createPublicKey(keyObject);
  const pubDer = pubKeyObj.export({ type: 'spki', format: 'der' });
  return pubDer.subarray(-32).toString('base64');
}

@Injectable()
export class CustomClientSettingsService {
  private signingKeyPromise: Promise<string> | null = null;

  constructor(
    @InjectRepository(SystemSetting)
    private settingRepository: Repository<SystemSetting>,
  ) {}

  async getSettings(): Promise<CustomClientSettingsResponse> {
    const token = await this.read(GITHUB_TOKEN_KEY);
    const repo = await this.read(GENERATOR_REPO_KEY);
    const ref = await this.read(GENERATOR_REF_KEY);
    const privKey = await this.getSigningPrivateKey();
    const publicKey = privKey ? derivePublicKeyBase64(privKey) : '';
    return {
      githubToken: token ? TOKEN_MASK : '',
      generatorRepo: repo ?? DEFAULT_GENERATOR_REPO,
      generatorRef: ref ?? DEFAULT_GENERATOR_REF,
      signingPublicKey: publicKey,
    };
  }

  async getActiveSettings(): Promise<{
    githubToken: string;
    generatorRepo: string;
    generatorRef: string;
  }> {
    const token = await this.read(GITHUB_TOKEN_KEY);
    const repo = await this.read(GENERATOR_REPO_KEY);
    const ref = await this.read(GENERATOR_REF_KEY);
    return {
      githubToken: token ?? '',
      generatorRepo: repo ?? DEFAULT_GENERATOR_REPO,
      generatorRef: ref ?? DEFAULT_GENERATOR_REF,
    };
  }

  async getSigningPrivateKey(): Promise<string> {
    if (this.signingKeyPromise) {
      return this.signingKeyPromise;
    }
    this.signingKeyPromise = (async () => {
      let privKey = await this.read(SIGNING_PRIVATE_KEY);
      if (!privKey) {
        privKey = generateEd25519PrivateKey();
        await this.write(SIGNING_PRIVATE_KEY, privKey, true);
      }
      return privKey;
    })();
    try {
      return await this.signingKeyPromise;
    } catch (err) {
      this.signingKeyPromise = null;
      throw err;
    }
  }

  async updateSettings(
    dto: UpdateCustomClientSettingsDto,
  ): Promise<CustomClientSettingsResponse> {
    if (dto.githubToken !== undefined && dto.githubToken !== TOKEN_MASK) {
      await this.write(GITHUB_TOKEN_KEY, dto.githubToken, true);
    }
    if (dto.generatorRepo !== undefined) {
      await this.write(GENERATOR_REPO_KEY, dto.generatorRepo, false);
    }
    if (dto.generatorRef !== undefined) {
      await this.write(GENERATOR_REF_KEY, dto.generatorRef, false);
    }
    if (dto.regenerateSigningKey) {
      const newPrivateKey = generateEd25519PrivateKey();
      await this.write(SIGNING_PRIVATE_KEY, newPrivateKey, true);
      this.signingKeyPromise = null;
    }
    return this.getSettings();
  }

  private async read(key: string): Promise<string | null> {
    const setting = await this.settingRepository.findOne({ where: { key } });
    return setting?.value ?? null;
  }

  private async write(
    key: string,
    value: string,
    sensitive: boolean,
  ): Promise<void> {
    let setting = await this.settingRepository.findOne({ where: { key } });
    if (setting) {
      setting.value = value;
    } else {
      setting = this.settingRepository.create({
        key,
        value,
        category: CATEGORY,
        isSensitive: sensitive,
      });
    }
    await this.settingRepository.save(setting);
  }
}
