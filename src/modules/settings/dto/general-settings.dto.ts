import { IsBoolean } from 'class-validator';

export class GeneralSettingsDto {
  watermarkEnabled: boolean;
}

export class UpdateGeneralSettingsDto {
  @IsBoolean()
  watermarkEnabled: boolean;
}
