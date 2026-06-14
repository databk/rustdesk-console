import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Client, SearchOptions } from 'ldapts';
import { User, UserStatus } from '../user/entities/user.entity';
import { LdapSettingsService, LdapConfig } from './ldap-settings.service';
import { LdapLoginDto } from './dto/ldap-login.dto';
import { LoginResponse } from '../../common/interfaces';
import { AuthTokenService } from '../auth/services/auth-token.service';
import { AuthDeviceService } from '../auth/services/auth-device.service';

/**
 * LDAP 用户信息接口
 * 从 LDAP 服务器获取的用户属性
 */
interface LdapUserInfo {
  /** 用户 DN */
  dn: string;
  /** 用户名 */
  username: string;
  /** 邮箱 */
  email?: string;
  /** 显示名称 */
  displayName?: string;
  /** 用户所属组 DN 列表 */
  groups: string[];
}

/**
 * LDAP 认证服务
 * 负责与 LDAP 服务器的交互，包括连接、搜索、验证和组映射
 *
 * 架构说明：
 * - 使用 ldapts 库进行 LDAP 协议交互
 * - 支持多服务器故障转移
 * - 使用服务账号绑定后搜索用户，再以用户 DN 绑定验证密码
 * - 支持组到管理员角色的映射
 * - JIT 自动创建本地用户
 */
@Injectable()
export class LdapService {
  private readonly logger = new Logger(LdapService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly ldapSettingsService: LdapSettingsService,
    @Inject(forwardRef(() => AuthTokenService))
    private readonly authTokenService: AuthTokenService,
    @Inject(forwardRef(() => AuthDeviceService))
    private readonly deviceService: AuthDeviceService,
  ) {}

  /**
   * LDAP 登录
   * 完整的 LDAP 认证流程：查找用户 → 验证密码 → 组映射 → 创建/关联本地用户 → 生成 Token
   *
   * @param loginDto LDAP 登录请求
   * @returns 登录响应
   */
  async login(loginDto: LdapLoginDto): Promise<LoginResponse> {
    const config = await this.ldapSettingsService.getActiveConfig();

    if (!config || !config.enabled) {
      throw new BadRequestException('LDAP 认证未启用');
    }

    // 1. 使用服务账号搜索用户
    const ldapUserInfo = await this.searchUser(config, loginDto.username);

    // 2. 使用用户 DN + 密码绑定验证
    await this.verifyUserPassword(config, ldapUserInfo.dn, loginDto.password);

    // 3. 查找用户所属组
    const groups = await this.searchUserGroups(config, ldapUserInfo.dn);
    ldapUserInfo.groups = groups;

    // 4. 查找或创建本地用户
    const user = await this.findOrCreateUser(ldapUserInfo, config);

    // 5. 创建或更新设备记录
    if (loginDto.id || loginDto.uuid) {
      await this.deviceService.createOrUpdateDevice(
        user.guid,
        loginDto.id,
        loginDto.uuid,
        loginDto.deviceInfo,
      );
    }

    // 6. 生成 JWT Token
    const token = await this.authTokenService.generateToken(
      user,
      loginDto.id,
      loginDto.uuid,
    );

    this.logger.log(`LDAP 用户登录成功: ${loginDto.username}`);

    return {
      access_token: token,
      type: 'access_token',
      user: {
        name: user.username,
        email: user.email || undefined,
        note: user.note || undefined,
        status: user.status,
        info: user.getUserInfo(),
        is_admin: user.isAdmin,
        third_auth_type: user.thirdAuthType || undefined,
        ...(user.avatar ? { avatar: user.avatar } : {}),
      },
    };
  }

  /**
   * 测试 LDAP 连接
   * 使用服务账号绑定到 LDAP 服务器并执行搜索，验证配置是否正确
   *
   * @param config LDAP 配置（可选，不传则使用当前生效配置）
   * @returns 测试结果
   */
  async testConnection(
    config?: LdapConfig,
  ): Promise<{ success: boolean; message: string }> {
    const activeConfig =
      config || (await this.ldapSettingsService.getActiveConfig());

    if (!activeConfig) {
      return { success: false, message: 'LDAP 配置不存在，请先配置' };
    }

    if (!activeConfig.urls || activeConfig.urls.length === 0) {
      return { success: false, message: 'LDAP 服务器 URL 不能为空' };
    }

    let client: Client | null = null;

    try {
      client = this.createClient(activeConfig);

      // 使用服务账号绑定
      await client.bind(activeConfig.bindDN, activeConfig.bindCredentials);

      // 执行搜索验证
      const searchBase = activeConfig.searchBase;
      const searchFilter = activeConfig.searchFilter.replace(
        '{{username}}',
        '*',
      );

      const { searchEntries } = await client.search(searchBase, {
        scope: 'sub',
        filter: searchFilter,
        sizeLimit: 1,
      });

      this.logger.log('LDAP 连接测试成功');
      return {
        success: true,
        message: `LDAP 连接测试成功，搜索基础 DN 下共 ${searchEntries.length} 条记录`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      this.logger.error(`LDAP 连接测试失败: ${message}`);
      return { success: false, message: `LDAP 连接测试失败: ${message}` };
    } finally {
      if (client) {
        try {
          await client.unbind();
        } catch {
          // 忽略 unbind 错误
        }
      }
    }
  }

  /**
   * 搜索 LDAP 用户
   * 使用服务账号绑定后搜索指定用户名的用户信息
   *
   * @param config LDAP 配置
   * @param username 用户名
   * @returns LDAP 用户信息
   * @throws UnauthorizedException 当用户不存在时抛出
   */
  private async searchUser(
    config: LdapConfig,
    username: string,
  ): Promise<LdapUserInfo> {
    let client: Client | null = null;

    try {
      client = this.createClient(config);

      // 使用服务账号绑定
      await client.bind(config.bindDN, config.bindCredentials);

      // 构建搜索过滤器
      const searchFilter = config.searchFilter.replace(
        '{{username}}',
        this.escapeLdapFilterValue(username),
      );

      const searchOptions: SearchOptions = {
        scope: 'sub',
        filter: searchFilter,
        attributes:
          config.searchAttributes.length > 0
            ? config.searchAttributes
            : undefined,
      };

      const { searchEntries } = await client.search(
        config.searchBase,
        searchOptions,
      );

      if (!searchEntries || searchEntries.length === 0) {
        throw new UnauthorizedException({ error: '用户名或密码错误' });
      }

      const entry = searchEntries[0] as Record<string, any>;

      const dn = String(entry.dn || entry.DN || '');
      const entryUsername = String(
        entry.sAMAccountName || entry.uid || entry.cn || username,
      );
      const entryEmail = entry.mail
        ? String(entry.mail)
        : entry.email
          ? String(entry.email)
          : undefined;
      const entryDisplayName = entry.displayName
        ? String(entry.displayName)
        : entry.cn
          ? String(entry.cn)
          : entry.name
            ? String(entry.name)
            : undefined;

      return {
        dn,
        username: entryUsername,
        email: entryEmail,
        displayName: entryDisplayName,
        groups: [],
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : '未知错误';
      this.logger.error(`LDAP 搜索用户失败: ${message}`);
      throw new UnauthorizedException({ error: 'LDAP 认证失败，请重试' });
    } finally {
      if (client) {
        try {
          await client.unbind();
        } catch {
          // 忽略 unbind 错误
        }
      }
    }
  }

  /**
   * 验证用户密码
   * 使用用户的 DN 和密码尝试绑定到 LDAP 服务器
   *
   * @param config LDAP 配置
   * @param userDN 用户 DN
   * @param password 密码
   * @throws UnauthorizedException 当密码错误时抛出
   */
  private async verifyUserPassword(
    config: LdapConfig,
    userDN: string,
    password: string,
  ): Promise<void> {
    let client: Client | null = null;

    try {
      client = this.createClient(config);

      // 使用用户 DN + 密码绑定
      await client.bind(userDN, password);

      this.logger.debug(`LDAP 用户密码验证成功: ${userDN}`);
    } catch {
      this.logger.warn(`LDAP 用户密码验证失败: ${userDN}`);
      throw new UnauthorizedException({ error: '用户名或密码错误' });
    } finally {
      if (client) {
        try {
          await client.unbind();
        } catch {
          // 忽略 unbind 错误
        }
      }
    }
  }

  /**
   * 搜索用户所属组
   * 使用服务账号绑定后搜索用户 DN 所属的组
   *
   * @param config LDAP 配置
   * @param userDN 用户 DN
   * @returns 组 DN 列表
   */
  private async searchUserGroups(
    config: LdapConfig,
    userDN: string,
  ): Promise<string[]> {
    if (!config.groupSearchBase || !config.groupSearchFilter) {
      return [];
    }

    let client: Client | null = null;

    try {
      client = this.createClient(config);

      // 使用服务账号绑定
      await client.bind(config.bindDN, config.bindCredentials);

      // 构建组搜索过滤器
      const groupFilter = config.groupSearchFilter.replace(
        '{{dn}}',
        this.escapeLdapFilterValue(userDN),
      );

      const { searchEntries } = await client.search(config.groupSearchBase, {
        scope: 'sub',
        filter: groupFilter,
        attributes: ['dn'],
      });

      return searchEntries
        .map((entry) => String((entry as Record<string, any>).dn || ''))
        .filter(Boolean);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      this.logger.warn(`LDAP 搜索用户组失败: ${message}`);
      return [];
    } finally {
      if (client) {
        try {
          await client.unbind();
        } catch {
          // 忽略 unbind 错误
        }
      }
    }
  }

  /**
   * 查找或创建本地用户
   * 根据 LDAP 用户信息匹配现有用户，不存在则自动创建（JIT Provisioning）
   *
   * 策略：
   * 1. 通过 thirdAuthType='ldap' + oidcSubject='ldap:{username}' 匹配已关联的 LDAP 用户
   * 2. 不通过邮箱自动关联已有账户（防止账户接管）
   * 3. 新用户设置 thirdAuthType 为 'ldap'
   * 4. 根据组映射决定是否为管理员
   * 5. 用户名冲突时追加随机后缀
   *
   * @param ldapUserInfo LDAP 用户信息
   * @param config LDAP 配置
   * @returns 本地用户实体
   */
  private async findOrCreateUser(
    ldapUserInfo: LdapUserInfo,
    config: LdapConfig,
  ): Promise<User> {
    // 通过 LDAP subject 查找已关联的用户
    const ldapSubject = `ldap:${ldapUserInfo.username}`;
    const existingUser = await this.userRepository.findOne({
      where: { oidcSubject: ldapSubject },
    });

    if (existingUser) {
      // 更新用户信息（邮箱、管理员角色）
      let needsUpdate = false;

      if (ldapUserInfo.email && existingUser.email !== ldapUserInfo.email) {
        existingUser.email = ldapUserInfo.email;
        needsUpdate = true;
      }

      // 根据组映射更新管理员角色
      const shouldBeAdmin = this.isAdminByGroups(
        ldapUserInfo.groups,
        config.adminGroups,
      );
      if (existingUser.isAdmin !== shouldBeAdmin) {
        existingUser.isAdmin = shouldBeAdmin;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await this.userRepository.save(existingUser);
      }

      return existingUser;
    }

    // 生成用户名
    const username =
      ldapUserInfo.username ||
      ldapUserInfo.displayName ||
      ldapUserInfo.email?.split('@')[0] ||
      `ldap_${uuidv4().substring(0, 8)}`;

    // 确保用户名唯一
    let finalUsername = username;
    let suffix = 1;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      while (
        await this.userRepository.findOne({
          where: { username: finalUsername },
        })
      ) {
        finalUsername = `${username}_${suffix}`;
        suffix++;
      }

      try {
        const userGuid = uuidv4();
        const user = new User();
        user.guid = userGuid;
        user.username = finalUsername;
        user.email = (ldapUserInfo.email || null) as string;
        user.password = null as unknown as string;
        user.status = UserStatus.ACTIVE;
        user.isAdmin = this.isAdminByGroups(
          ldapUserInfo.groups,
          config.adminGroups,
        );
        user.note = ldapUserInfo.displayName
          ? `LDAP用户 (${ldapUserInfo.displayName})`
          : 'LDAP用户';
        user.thirdAuthType = 'ldap';
        user.oidcSubject = ldapSubject;

        await this.userRepository.save(user);
        this.logger.log(`LDAP 用户已创建: ${finalUsername}`);
        return user;
      } catch (err: unknown) {
        if (
          err instanceof QueryFailedError &&
          String(err.message).includes('UNIQUE')
        ) {
          this.logger.warn(`用户名冲突，重试: ${finalUsername}`);
          suffix++;
          finalUsername = `${username}_${suffix}`;
          continue;
        }
        throw err;
      }
    }

    throw new Error(`创建 LDAP 用户失败，用户名冲突已重试 ${maxRetries} 次`);
  }

  /**
   * 根据组映射判断用户是否为管理员
   *
   * @param userGroups 用户所属组 DN 列表
   * @param adminGroups 管理员组 DN 列表
   * @returns 是否为管理员
   */
  private isAdminByGroups(
    userGroups: string[],
    adminGroups: string[],
  ): boolean {
    if (!adminGroups || adminGroups.length === 0) {
      return false;
    }

    return userGroups.some((userGroup) =>
      adminGroups.some((adminGroup) => this.dnEquals(userGroup, adminGroup)),
    );
  }

  /**
   * DN 大小写不敏感比较
   * LDAP DN 是大小写不敏感的
   */
  private dnEquals(dn1: string, dn2: string): boolean {
    return dn1.toLowerCase() === dn2.toLowerCase();
  }

  /**
   * 创建 LDAP 客户端
   * 支持多服务器故障转移
   *
   * @param config LDAP 配置
   * @returns LDAP 客户端实例
   * @throws BadRequestException 当所有服务器都无法连接时抛出
   */
  private createClient(config: LdapConfig): Client {
    const urls = config.urls;

    if (!urls || urls.length === 0) {
      throw new BadRequestException('LDAP 服务器 URL 未配置');
    }

    // 安全检查：非 LDAPS 协议给出警告
    for (const url of urls) {
      if (url.startsWith('ldap://') && !url.startsWith('ldaps://')) {
        this.logger.warn(
          `LDAP 连接使用非加密协议: ${url}，建议在生产环境中使用 LDAPS`,
        );
      }
    }

    // 尝试连接，支持故障转移
    let lastError: Error | null = null;

    for (const url of urls) {
      try {
        const client = new Client({
          url,
          timeout: 10000,
          connectTimeout: 5000,
          tlsOptions:
            Object.keys(config.tlsOptions || {}).length > 0
              ? config.tlsOptions
              : undefined,
        });

        // 验证连接是否可用
        return client;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`LDAP 服务器连接失败: ${url} - ${lastError.message}`);
      }
    }

    throw new BadRequestException(
      `无法连接到任何 LDAP 服务器: ${lastError?.message || '未知错误'}`,
    );
  }

  /**
   * 转义 LDAP 过滤器中的特殊字符
   * 防止 LDAP 注入攻击
   * 参考：RFC 4515 Section 3
   *
   * @param value 原始值
   * @returns 转义后的值
   */
  private escapeLdapFilterValue(value: string): string {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\\()*\u0000]/g, (char) => {
      const hex = char.charCodeAt(0).toString(16).padStart(2, '0');
      return `\\${hex}`;
    });
  }
}
