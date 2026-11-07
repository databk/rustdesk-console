import { Injectable, BadRequestException } from '@nestjs/common';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { resolve, relative } from 'path';
import { getCustomClientLogoPath } from '../../../common/utils/data-dir.util';

const ALLOWED_LOGO_FILES = [
  'logo.png',
  'logo_light.png',
  'logo_dark.png',
  'icon.png',
  'icon.ico',
];

@Injectable()
export class CustomClientLogoService {
  private readonly logoPath: string;

  constructor() {
    this.logoPath = getCustomClientLogoPath();
  }

  saveLogo(filename: string, buffer: Buffer): void {
    if (!ALLOWED_LOGO_FILES.includes(filename)) {
      throw new BadRequestException(
        `Invalid logo filename. Allowed: ${ALLOWED_LOGO_FILES.join(', ')}`,
      );
    }
    mkdirSync(this.logoPath, { recursive: true });
    const target = this.safeJoin(filename);
    rmSync(target, { force: true });
    writeFileSync(target, buffer);
  }

  getLogoPath(filename: string): string {
    if (!ALLOWED_LOGO_FILES.includes(filename)) {
      throw new BadRequestException(
        `Invalid logo filename. Allowed: ${ALLOWED_LOGO_FILES.join(', ')}`,
      );
    }
    return this.safeJoin(filename);
  }

  listLogos(): string[] {
    if (!existsSync(this.logoPath)) {
      return [];
    }
    return readdirSync(this.logoPath).filter((f) => {
      try {
        return statSync(this.safeJoin(f)).isFile();
      } catch {
        return false;
      }
    });
  }

  deleteLogo(filename: string): void {
    if (!ALLOWED_LOGO_FILES.includes(filename)) {
      throw new BadRequestException(
        `Invalid logo filename. Allowed: ${ALLOWED_LOGO_FILES.join(', ')}`,
      );
    }
    rmSync(this.safeJoin(filename), { force: true });
  }

  hasLogo(filename: string): boolean {
    if (!ALLOWED_LOGO_FILES.includes(filename)) {
      return false;
    }
    return existsSync(this.safeJoin(filename));
  }

  private safeJoin(...segments: string[]): string {
    const target = resolve(this.logoPath, ...segments);
    const rel = relative(this.logoPath, target);
    if (rel.startsWith('..') || resolve(this.logoPath) === target) {
      throw new BadRequestException('Invalid path');
    }
    return target;
  }
}
