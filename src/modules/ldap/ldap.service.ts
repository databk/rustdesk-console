import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Client, SearchOptions } from 'ldapts';
import { User, UserStatus } from '../user/entities/user.entity';
import { LdapSettingsService, LdapConfig } from './ldap-settings.service';
import { TlsOptionsDto } from './dto/ldap-config.dto';
import { UserGroupService } from '../user-group/user-group.service';

/**
 * LDAP user information interface
 * User attributes retrieved from the LDAP server
 */
interface LdapUserInfo {
  /** User DN */
  dn: string;
  /** Username */
  username: string;
  /** Email */
  email?: string;
  /** Display name */
  displayName?: string;
  /** List of DNs of groups the user belongs to */
  groups: string[];
}

/**
 * LDAP authentication service
 * Handles interaction with the LDAP server, including connection, search, verification, and group mapping
 *
 * Architecture notes:
 * - Uses the ldapts library for LDAP protocol interaction
 * - Supports multi-server failover
 * - Binds with the service account to search for the user, then binds with the user DN to verify the password
 * - Supports mapping groups to administrator roles
 * - JIT automatic creation of local users
 * - authenticate() only returns the authenticated User entity; token generation is handled uniformly by AuthService
 */
@Injectable()
export class LdapService {
  private readonly logger = new Logger(LdapService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly ldapSettingsService: LdapSettingsService,
    private readonly userGroupService: UserGroupService,
  ) {}

  /**
   * LDAP authentication (authentication only, no token generation)
   * Full LDAP authentication flow: find user -> verify password -> group mapping -> create/link local user
   * Token generation and device management are handled uniformly by AuthService to avoid circular dependencies
   *
   * @param username Username
   * @param password password
   * @returns the local user entity after successful authentication
   * @throws BadRequestException thrown when LDAP is not enabled
   * @throws UnauthorizedException Thrown when authentication fails
   */
  async authenticate(username: string, password: string): Promise<User> {
    const config = await this.ldapSettingsService.getActiveConfig();

    if (!config || !config.enabled) {
      throw new BadRequestException('LDAP authentication is not enabled');
    }

    // 1. Search for the user with the service account
    const ldapUserInfo = await this.searchUser(config, username);

    // 2. Verify by binding with the user DN + password
    await this.verifyUserPassword(config, ldapUserInfo.dn, password);

    // 3. Find the groups the user belongs to
    const groups = await this.searchUserGroups(config, ldapUserInfo.dn);
    ldapUserInfo.groups = groups;

    // 4. Find or create the local user
    const user = await this.findOrCreateUser(ldapUserInfo, config);

    // 5. Check the user status
    if (user.status === UserStatus.DISABLED) {
      throw new UnauthorizedException({ error: 'Account has been disabled' });
    }

    this.logger.log(`LDAP user authenticated successfully: ${username}`);

    return user;
  }

  /**
   * Check whether LDAP is enabled
   */
  async isEnabled(): Promise<boolean> {
    return this.ldapSettingsService.isEnabled();
  }

  /**
   * Check whether the user is a linked LDAP user
   * Determined via the oidcSubject field
   *
   * @param username Username
   * @returns returns true if the user is a linked LDAP user
   */
  async isLinkedLdapUser(username: string): Promise<boolean> {
    const ldapSubject = `ldap:${username}`;
    const user = await this.userRepository.findOne({
      where: { oidcSubject: ldapSubject },
    });
    return !!user;
  }

  /**
   * Test LDAP connection
   * Binds to the LDAP server with the service account and performs a search to verify the configuration is correct
   *
   * @param config LDAP configuration (optional; if omitted, the currently active configuration is used)
   * @returns test result
   */
  async testConnection(
    config?: LdapConfig,
  ): Promise<{ success: boolean; message: string }> {
    const activeConfig =
      config || (await this.ldapSettingsService.getActiveConfig());

    if (!activeConfig) {
      return {
        success: false,
        message: 'LDAP configuration does not exist, please configure it first',
      };
    }

    if (!activeConfig.urls || activeConfig.urls.length === 0) {
      return { success: false, message: 'LDAP server URL cannot be empty' };
    }

    try {
      await this.executeWithFailover(activeConfig, async (client) => {
        // Bind with the service account
        await client.bind(activeConfig.bindDN, activeConfig.bindCredentials);

        // Perform a search to verify
        const searchFilter = activeConfig.searchFilter.replace(
          '{{username}}',
          '*',
        );

        await client.search(activeConfig.searchBase, {
          scope: 'sub',
          filter: searchFilter,
          sizeLimit: 1,
        });
      });

      this.logger.log('LDAP connection test succeeded');
      return { success: true, message: 'LDAP connection test succeeded' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`LDAP connection test failed: ${message}`);
      return {
        success: false,
        message: `LDAP connection test failed: ${message}`,
      };
    }
  }

  /**
   * Search for an LDAP user
   * Binds with the service account and searches for the user information of the given username
   *
   * @param config LDAP configuration
   * @param username Username
   * @returns LDAP user information
   * @throws UnauthorizedException Thrown when the user does not exist
   */
  private async searchUser(
    config: LdapConfig,
    username: string,
  ): Promise<LdapUserInfo> {
    try {
      return await this.executeWithFailover(config, async (client) => {
        // Bind with the service account
        await client.bind(config.bindDN, config.bindCredentials);

        // Build the search filter
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
          throw new UnauthorizedException({
            error: 'Incorrect username or password',
          });
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
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`LDAP user search failed: ${message}`);
      throw new UnauthorizedException({
        error: 'LDAP authentication failed, please retry',
      });
    }
  }

  /**
   * Verify user password
   * Attempts to bind to the LDAP server with the user DN and password
   *
   * @param config LDAP configuration
   * @param userDN User DN
   * @param password password
   * @throws UnauthorizedException thrown when the password is incorrect
   */
  private async verifyUserPassword(
    config: LdapConfig,
    userDN: string,
    password: string,
  ): Promise<void> {
    try {
      await this.executeWithFailover(config, async (client) => {
        // Bind with the user DN + password
        await client.bind(userDN, password);
      });
      this.logger.debug(`LDAP user password verified successfully: ${userDN}`);
    } catch {
      this.logger.warn(`LDAP user password verification failed: ${userDN}`);
      throw new UnauthorizedException({
        error: 'Incorrect username or password',
      });
    }
  }

  /**
   * Search for the groups the user belongs to
   * Binds with the service account and searches for the groups the user DN belongs to
   *
   * @param config LDAP configuration
   * @param userDN User DN
   * @returns list of group DNs
   */
  private async searchUserGroups(
    config: LdapConfig,
    userDN: string,
  ): Promise<string[]> {
    if (!config.groupSearchBase || !config.groupSearchFilter) {
      return [];
    }

    try {
      return await this.executeWithFailover(config, async (client) => {
        // Bind with the service account
        await client.bind(config.bindDN, config.bindCredentials);

        // Build the group search filter
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
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`LDAP group search failed: ${message}`);
      return [];
    }
  }

  /**
   * Find or create the local user
   * Matches an existing user using the LDAP user information; automatically creates one if it does not exist (JIT Provisioning)
   *
   * Strategy:
   * 1. Match linked LDAP users via thirdAuthType='ldap' + oidcSubject='ldap:{username}'
   * 2. Do not automatically link existing accounts by email (prevents account takeover)
   * 3. New users get thirdAuthType set to 'ldap'
   * 4. Group mapping determines whether the user is an administrator
   * 5. Append a random suffix on username conflict
   *
   * @param ldapUserInfo LDAP user information
   * @param config LDAP configuration
   * @returns the local user entity
   */
  private async findOrCreateUser(
    ldapUserInfo: LdapUserInfo,
    _config: LdapConfig,
  ): Promise<User> {
    // Find the linked user via the LDAP subject
    const ldapSubject = `ldap:${ldapUserInfo.username}`;
    const existingUser = await this.userRepository.findOne({
      where: { oidcSubject: ldapSubject },
    });

    if (existingUser) {
      // LDAP may authenticate and update profile data, but never controls the
      // immutable system-owner marker.
      let needsUpdate = false;

      if (ldapUserInfo.email && existingUser.email !== ldapUserInfo.email) {
        existingUser.email = ldapUserInfo.email;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await this.userRepository.save(existingUser);
      }

      return existingUser;
    }

    // Generate the username
    const username =
      ldapUserInfo.username ||
      ldapUserInfo.displayName ||
      ldapUserInfo.email?.split('@')[0] ||
      `ldap_${uuidv4().substring(0, 8)}`;

    // Ensure the username is unique
    let finalUsername = username;
    let suffix = 1;
    const maxRetries = 3;
    const userGroupGuid = await this.userGroupService.resolveUserGroupGuid();

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
        user.email = ldapUserInfo.email || null;
        user.password = null as unknown as string;
        user.status = UserStatus.ACTIVE;
        user.isAdmin = false;
        user.note = ldapUserInfo.displayName
          ? `LDAPUser (${ldapUserInfo.displayName})`
          : 'LDAPUser';
        user.thirdAuthType = 'ldap';
        user.oidcSubject = ldapSubject;
        user.userGroupGuid = userGroupGuid;

        await this.userRepository.save(user);
        this.logger.log(`LDAP user created: ${finalUsername}`);
        return user;
      } catch (err: unknown) {
        if (
          err instanceof QueryFailedError &&
          String(err.message).includes('UNIQUE')
        ) {
          this.logger.warn(`Username conflict, retrying: ${finalUsername}`);
          suffix++;
          finalUsername = `${username}_${suffix}`;
          continue;
        }
        throw err;
      }
    }

    throw new Error(
      `Failed to create LDAP user, username conflict retried ${maxRetries} times`,
    );
  }

  /**
   * Execute an LDAP operation with failover
   * Iterates over all URLs, runs the operation on the first available server, and tries the next one on failure
   * The actual TCP connection is established when bind() is called, so failover is implemented at the operation level
   *
   * @param config LDAP configuration
   * @param operation the LDAP operation to execute (receives the connected client)
   * @returns the return value of the operation
   * @throws BadRequestException thrown when all servers are unreachable
   */
  private async executeWithFailover<T>(
    config: LdapConfig,
    operation: (client: Client) => Promise<T>,
  ): Promise<T> {
    const urls = config.urls;

    if (!urls || urls.length === 0) {
      throw new BadRequestException('LDAP server URL is not configured');
    }

    // Security check: warn when the protocol is not LDAPS
    for (const url of urls) {
      if (url.startsWith('ldap://') && !url.startsWith('ldaps://')) {
        this.logger.warn(
          `LDAP connection uses an unencrypted protocol: ${url}, LDAPS is recommended in production`,
        );
      }
    }

    let lastError: Error | null = null;

    for (const url of urls) {
      const client = this.createClientForUrl(url, config);
      try {
        return await operation(client);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `LDAP server operation failed: ${url} - ${lastError.message}`,
        );
      } finally {
        try {
          await client.unbind();
        } catch {
          // Ignore unbind errors
        }
      }
    }

    throw new BadRequestException(
      `Unable to connect to any LDAP server: ${lastError?.message || 'Unknown error'}`,
    );
  }

  /**
   * Create an LDAP client for a single URL
   * Safely map TlsOptionsDto to Node.js TLS options
   *
   * @param url LDAP server URL
   * @param config LDAP configuration
   * @returns LDAP client instance
   */
  private createClientForUrl(url: string, config: LdapConfig): Client {
    const tlsOptions = this.buildTlsOptions(config.tlsOptions);
    return new Client({
      url,
      timeout: 10000,
      connectTimeout: 5000,
      tlsOptions: Object.keys(tlsOptions).length > 0 ? tlsOptions : undefined,
    });
  }

  /**
   * Safely map TlsOptionsDto to Node.js TLS options
   * Only allowlisted properties are permitted, preventing injection of dangerous options
   */
  private buildTlsOptions(
    dto: TlsOptionsDto | Record<string, unknown>,
  ): Record<string, unknown> {
    if (!dto || typeof dto !== 'object') {
      return {};
    }

    const result: Record<string, unknown> = {};
    const allowedKeys = ['ca', 'cert', 'key', 'servername'] as const;

    for (const key of allowedKeys) {
      if (dto[key] !== undefined && dto[key] !== null && dto[key] !== '') {
        result[key] = dto[key];
      }
    }

    return result;
  }

  /**
   * Escape special characters in LDAP filters
   * Prevents LDAP injection attacks
   * Reference: RFC 4515 Section 3
   *
   * @param value the raw value
   * @returns the escaped value
   */
  private escapeLdapFilterValue(value: string): string {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\\()*\u0000]/g, (char) => {
      const hex = char.charCodeAt(0).toString(16).padStart(2, '0');
      return `\\${hex}`;
    });
  }
}
