import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import * as nodemailer from 'nodemailer';
import { SmtpConfig } from '../entities/smtp-config.entity';
import {
  CreateSmtpConfigDto,
  UpdateSmtpConfigDto,
  TestSmtpConfigDto,
} from '../dto/smtp-config.dto';

/**
 * SMTP 配置服务
 * 管理 SMTP 配置的 CRUD 操作和连接测试
 */
@Injectable()
export class SmtpSettingsService {
  private readonly logger = new Logger(SmtpSettingsService.name);

  /** 密码脱敏占位符 */
  private readonly PASS_MASK = '******';

  constructor(
    @InjectRepository(SmtpConfig)
    private smtpConfigRepository: Repository<SmtpConfig>,
  ) {}

  /**
   * 获取当前生效的 SMTP 配置（含密码，供内部服务使用）
   */
  async getActiveConfig(): Promise<SmtpConfig | null> {
    const config = await this.smtpConfigRepository
      .createQueryBuilder('smtp')
      .where('smtp.isDefault = :isDefault', { isDefault: true })
      .andWhere('smtp.enabled = :enabled', { enabled: true })
      .addSelect('smtp.pass')
      .getOne();

    return config || null;
  }

  /**
   * 获取 SMTP 配置（密码脱敏，供 API 返回）
   */
  async getSmtpConfig(): Promise<Partial<SmtpConfig>> {
    const config = await this.smtpConfigRepository
      .createQueryBuilder('smtp')
      .where('smtp.isDefault = :isDefault', { isDefault: true })
      .addSelect('smtp.pass')
      .getOne();

    if (!config) {
      throw new NotFoundException('SMTP 配置不存在');
    }

    return this.maskPassword(config);
  }

  /**
   * 创建 SMTP 配置
   */
  async createSmtpConfig(dto: CreateSmtpConfigDto): Promise<Partial<SmtpConfig>> {
    // 检查是否已存在默认配置
    const existing = await this.smtpConfigRepository.findOne({
      where: { isDefault: true },
    });

    if (existing) {
      // 已存在默认配置，执行更新
      return this.updateSmtpConfig({
        host: dto.host,
        port: dto.port,
        secure: dto.secure,
        user: dto.user,
        pass: dto.pass,
        from: dto.from,
      });
    }

    const config = this.smtpConfigRepository.create({
      guid: uuidv4(),
      host: dto.host,
      port: dto.port,
      secure: dto.secure ?? false,
      user: dto.user,
      pass: dto.pass,
      from: dto.from,
      enabled: true,
      isDefault: true,
    });

    const saved = await this.smtpConfigRepository.save(config);
    this.logger.log('SMTP 配置已创建');
    return this.maskPassword(saved);
  }

  /**
   * 更新 SMTP 配置
   * 如果 pass 字段为脱敏占位符，则不更新密码
   */
  async updateSmtpConfig(dto: UpdateSmtpConfigDto): Promise<Partial<SmtpConfig>> {
    const config = await this.smtpConfigRepository
      .createQueryBuilder('smtp')
      .where('smtp.isDefault = :isDefault', { isDefault: true })
      .addSelect('smtp.pass')
      .getOne();

    if (!config) {
      throw new NotFoundException('SMTP 配置不存在，请先创建');
    }

    // 更新字段
    if (dto.host !== undefined) config.host = dto.host;
    if (dto.port !== undefined) config.port = dto.port;
    if (dto.secure !== undefined) config.secure = dto.secure;
    if (dto.user !== undefined) config.user = dto.user;
    if (dto.from !== undefined) config.from = dto.from;
    if (dto.enabled !== undefined) config.enabled = dto.enabled;
    // 仅在传入非占位符密码时更新
    if (dto.pass !== undefined && dto.pass !== this.PASS_MASK) {
      config.pass = dto.pass;
    }

    const saved = await this.smtpConfigRepository.save(config);
    this.logger.log('SMTP 配置已更新');
    return this.maskPassword(saved);
  }

  /**
   * 测试 SMTP 连接
   * 如果传入配置则测试该配置，否则测试当前生效配置
   */
  async testSmtpConnection(
    dto?: TestSmtpConfigDto,
  ): Promise<{ success: boolean; message: string }> {
    let host: string;
    let port: number;
    let secure: boolean;
    let user: string;
    let pass: string;

    if (dto && dto.host) {
      // 使用传入的配置进行测试
      host = dto.host;
      port = dto.port ?? 587;
      secure = dto.secure ?? false;
      user = dto.user ?? '';
      pass = dto.pass ?? '';
    } else {
      // 使用当前生效配置进行测试
      const config = await this.getActiveConfig();
      if (!config) {
        return { success: false, message: 'SMTP 配置不存在，请先配置' };
      }
      host = config.host;
      port = config.port;
      secure = config.secure;
      user = config.user;
      pass = config.pass;
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });

    try {
      await transporter.verify();
      this.logger.log('SMTP 连接测试成功');
      return { success: true, message: 'SMTP 连接测试成功' };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '未知错误';
      this.logger.error(`SMTP 连接测试失败: ${message}`);
      return { success: false, message: `SMTP 连接测试失败: ${message}` };
    } finally {
      transporter.close();
    }
  }

  /**
   * 密码脱敏处理
   */
  private maskPassword(
    config: SmtpConfig,
  ): Partial<SmtpConfig> & { pass: string } {
    return {
      ...config,
      pass: this.PASS_MASK,
    };
  }
}
