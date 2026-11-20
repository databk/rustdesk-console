import { randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../settings/entities/system-setting.entity';

const SETTING_KEY = 'auth.jwt.secret';
const SETTING_CATEGORY = 'auth';

/**
 * Module-level cache. AuthModule initializes this asynchronously during
 * JwtModule.registerAsync, and JwtStrategy reads it synchronously from its
 * constructor (which must have a ready string for Passport).
 *
 * This avoids the chicken-and-egg problem where the JWT secret must be
 * resolved from the DB before any auth module provider is constructed.
 */
let cachedSecret: string | undefined;

export function getCachedJwtSecret(): string {
  return cachedSecret ?? '';
}

/**
 * Resolve JWT signing secret with three-tier priority:
 *
 *  1. JWT_SECRET environment variable (explicit production override)
 *  2. Previously persisted value in system_settings table
 *  3. Auto-generated random secret, persisted to DB for future restarts
 *
 * Must be awaited BEFORE JwtStrategy is instantiated — i.e. inside
 * JwtModule.registerAsync.useFactory.
 */
@Injectable()
export class JwtSecretService {
  private readonly logger = new Logger(JwtSecretService.name);

  constructor(
    @InjectRepository(SystemSetting)
    private settingRepo: Repository<SystemSetting>,
  ) {}

  async resolveSecret(): Promise<string> {
    // Priority 1: environment variable
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length >= 16) {
      cachedSecret = process.env.JWT_SECRET.trim();
      this.logger.log('Using JWT secret from JWT_SECRET environment variable');
      return cachedSecret;
    }

    // Priority 2: DB-persisted value (survives restarts, reinstalls, etc.)
    const row = await this.settingRepo.findOne({ where: { key: SETTING_KEY } });
    if (row?.value && row.value.length >= 16) {
      cachedSecret = row.value;
      this.logger.log('Using JWT secret persisted in system_settings (auth.jwt.secret)');
      return cachedSecret;
    }

    // Priority 3: generate fresh random secret and persist
    const secret = randomBytes(48).toString('base64'); // 64 chars base64
    await this.settingRepo.save({
      key: SETTING_KEY,
      value: secret,
      category: SETTING_CATEGORY,
      description: 'Auto-generated JWT signing secret. Shared with hbbs RD_MANAGEMENT_TOKEN.',
      isSensitive: true,
    });
    cachedSecret = secret;
    this.logger.warn(
      'JWT_SECRET not set and no persisted secret found. Generated a random one and stored it in the database. For production, set JWT_SECRET in the environment or configure it manually.',
    );
    return cachedSecret;
  }
}
