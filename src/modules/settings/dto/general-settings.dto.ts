import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateBy,
} from 'class-validator';

export const containsControlCharacters = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });

const HasNoControlCharacters = () =>
  ValidateBy({
    name: 'hasNoControlCharacters',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && !containsControlCharacters(value),
      defaultMessage: () => 'siteName must not contain control characters',
    },
  });

export class GeneralSettingsDto {
  siteName: string;
  watermarkEnabled: boolean;
}

export class UpdateGeneralSettingsDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @HasNoControlCharacters()
  siteName: string;

  @IsBoolean()
  watermarkEnabled: boolean;
}
