import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  GeneralSettingsDto,
  UpdateGeneralSettingsDto,
} from '../dto/general-settings.dto';
import { SystemSetting } from '../entities/system-setting.entity';

const CATEGORY = 'general';
const WATERMARK_ENABLED_KEY = 'general.watermarkEnabled';

@Injectable()
export class GeneralSettingsService {
  constructor(
    @InjectRepository(SystemSetting)
    private readonly settingRepository: Repository<SystemSetting>,
    private readonly dataSource: DataSource,
  ) {}

  async getSettings(): Promise<GeneralSettingsDto> {
    const settings = await this.settingRepository.find({
      where: { key: In([WATERMARK_ENABLED_KEY]) },
    });
    const values = new Map(
      settings.map((setting) => [setting.key, setting.value]),
    );

    return {
      watermarkEnabled: this.readWatermarkEnabled(
        values.get(WATERMARK_ENABLED_KEY),
      ),
    };
  }

  async updateSettings(
    dto: UpdateGeneralSettingsDto,
  ): Promise<GeneralSettingsDto> {
    const settings = {
      watermarkEnabled: dto.watermarkEnabled,
    };

    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SystemSetting);
      const existing = await repository.find({
        where: { key: In([WATERMARK_ENABLED_KEY]) },
      });
      const existingByKey = new Map(existing.map((item) => [item.key, item]));
      const values = new Map<string, string>([
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

  private readWatermarkEnabled(value: string | undefined): boolean {
    if (value === 'false') return false;
    return true;
  }
}
