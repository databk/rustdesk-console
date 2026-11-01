import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../../settings/entities/system-setting.entity';
import {
  UpdateCustomClientSettingsDto,
  CustomClientSettingsResponse,
} from '../dto/custom-client-settings.dto';

const CATEGORY = 'custom-client';
const GITHUB_TOKEN_KEY = 'custom-client.github-token';
const GENERATOR_REPO_KEY = 'custom-client.generator-repo';
const GENERATOR_REF_KEY = 'custom-client.generator-ref';
const DEFAULT_GENERATOR_REPO = 'databk/rustdesk-generator';
const DEFAULT_GENERATOR_REF = 'main';
const TOKEN_MASK = '******';

@Injectable()
export class CustomClientSettingsService {
  constructor(
    @InjectRepository(SystemSetting)
    private settingRepository: Repository<SystemSetting>,
  ) {}

  async getSettings(): Promise<CustomClientSettingsResponse> {
    const token = await this.read(GITHUB_TOKEN_KEY);
    const repo = await this.read(GENERATOR_REPO_KEY);
    const ref = await this.read(GENERATOR_REF_KEY);
    return {
      githubToken: token ? TOKEN_MASK : '',
      generatorRepo: repo ?? DEFAULT_GENERATOR_REPO,
      generatorRef: ref ?? DEFAULT_GENERATOR_REF,
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
