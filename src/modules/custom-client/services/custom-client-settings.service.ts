import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { generateKeyPairSync } from 'crypto';
import { SystemSetting } from '../../settings/entities/system-setting.entity';
import {
  UpdateCustomClientSettingsDto,
  CustomClientSettingsResponse,
} from '../dto/custom-client-settings.dto';

const CATEGORY = 'custom-client';
const GITHUB_TOKEN_KEY = 'custom-client.github-token';
const GENERATOR_REPO_KEY = 'custom-client.generator-repo';
const GENERATOR_REF_KEY = 'custom-client.generator-ref';
const SIGNING_PUBLIC_KEY = 'custom-client.signing-public-key';
const SIGNING_PRIVATE_KEY = 'custom-client.signing-private-key';
const DEFAULT_GENERATOR_REPO = 'databk/rustdesk-generator';
const DEFAULT_GENERATOR_REF = 'main';
const TOKEN_MASK = '******';

function generateEd25519KeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const rawPub = pubDer.subarray(-32);
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  return {
    publicKey: rawPub.toString('base64'),
    privateKey: privDer.toString('base64'),
  };
}

@Injectable()
export class CustomClientSettingsService {
  private signingKeysPromise: Promise<{
    publicKey: string;
    privateKey: string;
  }> | null = null;

  constructor(
    @InjectRepository(SystemSetting)
    private settingRepository: Repository<SystemSetting>,
  ) {}

  async getSettings(): Promise<CustomClientSettingsResponse> {
    const token = await this.read(GITHUB_TOKEN_KEY);
    const repo = await this.read(GENERATOR_REPO_KEY);
    const ref = await this.read(GENERATOR_REF_KEY);
    const pubKey = await this.read(SIGNING_PUBLIC_KEY);
    const privKey = await this.read(SIGNING_PRIVATE_KEY);
    return {
      githubToken: token ? TOKEN_MASK : '',
      generatorRepo: repo ?? DEFAULT_GENERATOR_REPO,
      generatorRef: ref ?? DEFAULT_GENERATOR_REF,
      signingPublicKey: pubKey ?? '',
      signingPrivateKey: privKey ? TOKEN_MASK : '',
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

  async getSigningKeys(): Promise<{
    publicKey: string;
    privateKey: string;
  }> {
    if (this.signingKeysPromise) {
      return this.signingKeysPromise;
    }
    this.signingKeysPromise = (async () => {
      let pubKey = await this.read(SIGNING_PUBLIC_KEY);
      let privKey = await this.read(SIGNING_PRIVATE_KEY);
      if (!pubKey || !privKey) {
        const keys = generateEd25519KeyPair();
        pubKey = keys.publicKey;
        privKey = keys.privateKey;
        await this.write(SIGNING_PUBLIC_KEY, pubKey, false);
        await this.write(SIGNING_PRIVATE_KEY, privKey, true);
      }
      return { publicKey: pubKey, privateKey: privKey };
    })();
    try {
      return await this.signingKeysPromise;
    } catch (err) {
      this.signingKeysPromise = null;
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
    if (dto.signingPublicKey !== undefined) {
      await this.write(SIGNING_PUBLIC_KEY, dto.signingPublicKey, false);
    }
    if (
      dto.signingPrivateKey !== undefined &&
      dto.signingPrivateKey !== TOKEN_MASK
    ) {
      await this.write(SIGNING_PRIVATE_KEY, dto.signingPrivateKey, true);
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
