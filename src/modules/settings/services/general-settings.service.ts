import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  GeneralSettingsDto,
  UpdateGeneralSettingsDto,
  containsControlCharacters,
} from '../dto/general-settings.dto';
import { SystemSetting } from '../entities/system-setting.entity';

const CATEGORY = 'console';
const SITE_NAME_KEY = 'console.siteName';
const WATERMARK_ENABLED_KEY = 'console.watermarkEnabled';
const DEFAULT_SITE_NAME = 'RustDesk Console';

@Injectable()
export class GeneralSettingsService {
  constructor(
    @InjectRepository(SystemSetting)
    private readonly settingRepository: Repository<SystemSetting>,
    private readonly dataSource: DataSource,
  ) {}

  async getSettings(): Promise<GeneralSettingsDto> {
    const settings = await this.settingRepository.find({
      where: { key: In([SITE_NAME_KEY, WATERMARK_ENABLED_KEY]) },
    });
    const values = new Map(
      settings.map((setting) => [setting.key, setting.value]),
    );

    return {
      siteName: this.readSiteName(values.get(SITE_NAME_KEY)),
      watermarkEnabled: this.readWatermarkEnabled(
        values.get(WATERMARK_ENABLED_KEY),
      ),
    };
  }

  async updateSettings(
    dto: UpdateGeneralSettingsDto,
  ): Promise<GeneralSettingsDto> {
    const settings = {
      siteName: dto.siteName.trim(),
      watermarkEnabled: dto.watermarkEnabled,
    };

    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SystemSetting);
      const existing = await repository.find({
        where: { key: In([SITE_NAME_KEY, WATERMARK_ENABLED_KEY]) },
      });
      const existingByKey = new Map(existing.map((item) => [item.key, item]));
      const values = new Map<string, string>([
        [SITE_NAME_KEY, settings.siteName],
        [WATERMARK_ENABLED_KEY, String(settings.watermarkEnabled)],
      ]);

      const entities = [...values].map(([key, value]) => {
        const setting = existingByKey.get(key) || repository.create({ key });
        setting.value = value;
        setting.category = CATEGORY;
        setting.isSensitive = false;
        return setting;
      });

      await repository.save(entities);
    });

    return settings;
  }

  private readSiteName(value: string | undefined): string {
    const siteName = value?.trim() || '';
    const length = Array.from(siteName).length;
    const hasControlCharacters = containsControlCharacters(siteName);

    return length >= 1 && length <= 64 && !hasControlCharacters
      ? siteName
      : DEFAULT_SITE_NAME;
  }

  private readWatermarkEnabled(value: string | undefined): boolean {
    if (value === 'false') return false;
    return true;
  }
}
