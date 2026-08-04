import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { LoginSession } from '../entities/login-session.entity';
import { PASSKEY_SESSION_EXPIRY_MINUTES } from '../auth.constants';

/** 创建登录会话的参数 */
export interface CreateSessionParams {
  /** 所属用户 GUID */
  userGuid: string;
  /** 验证方式 */
  method: LoginSession['method'];
  /** 验证码 / challenge（邮箱验证码或 WebAuthn challenge） */
  code?: string;
  /** 待验证邮箱（仅邮箱验证方式） */
  email?: string;
  /** 会话有效期（分钟），默认使用 Passkey 会话有效期常量 */
  expiryMinutes?: number;
  /** 是否先删除该用户未使用的会话，默认 false */
  deleteExisting?: boolean;
}

/**
 * 登录会话服务
 * 统一管理登录二次验证会话的创建、查找、标记和清理，
 * 消除 AuthTfaService / AuthEmailService / AuthPasskeyService 中的重复逻辑
 */
@Injectable()
export class LoginSessionService {
  constructor(
    @InjectRepository(LoginSession)
    private readonly loginSessionRepository: Repository<LoginSession>,
  ) {}

  /**
   * 创建登录会话
   * 可选先清除该用户之前未使用的会话，避免会话堆积
   */
  async createSession(params: CreateSessionParams): Promise<LoginSession> {
    const {
      userGuid,
      method,
      code,
      email,
      expiryMinutes = PASSKEY_SESSION_EXPIRY_MINUTES,
      deleteExisting = false,
    } = params;

    if (deleteExisting) {
      await this.deleteUserUnusedSessions(userGuid);
    }

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + expiryMinutes);

    const session = this.loginSessionRepository.create({
      guid: uuidv4(),
      userGuid,
      method,
      email,
      code,
      expiresAt,
      used: false,
    });

    return this.loginSessionRepository.save(session);
  }

  /**
   * 查找用户指定方式下最新且有效的未使用会话
   */
  async findValidSession(
    userGuid: string,
    method: LoginSession['method'],
  ): Promise<LoginSession | null> {
    return this.loginSessionRepository.findOne({
      where: {
        userGuid,
        method,
        used: false,
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 通过会话 GUID 查找会话
   * 可选按 method / used / 有效期 过滤
   */
  async findByGuid(
    guid: string,
    options: {
      method?: LoginSession['method'];
      used?: boolean;
      checkExpiry?: boolean;
    } = {},
  ): Promise<LoginSession | null> {
    const where: Record<string, unknown> = { guid };

    if (options.method !== undefined) {
      where.method = options.method;
    }
    if (options.used !== undefined) {
      where.used = options.used;
    }
    if (options.checkExpiry) {
      where.expiresAt = MoreThan(new Date());
    }

    return this.loginSessionRepository.findOne({ where });
  }

  /**
   * 标记会话为已使用，防止重放攻击
   */
  async markSessionUsed(session: LoginSession): Promise<void> {
    session.used = true;
    await this.loginSessionRepository.save(session);
  }

  /**
   * 删除指定用户所有未使用的会话
   * 在发起新的二次验证前调用，避免会话堆积
   */
  async deleteUserUnusedSessions(userGuid: string): Promise<void> {
    await this.loginSessionRepository.delete({
      userGuid,
      used: false,
    });
  }
}
