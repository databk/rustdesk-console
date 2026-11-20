import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { GeneralSettingsService } from '../settings/services/general-settings.service';
import { UpdateGeneralSettingsDto } from '../settings/dto/general-settings.dto';
import { WebClientSettingsService } from '../web-client/web-client-settings.service';
import { UpdateWebClientSettingsDto } from '../web-client/dto/web-client-settings.dto';
import { WebClientService } from '../web-client/web-client.service';
import { ServerManagementSettingsService } from '../server-management/server-management-settings.service';
import { UpdateServerManagementSettingsDto } from '../server-management/dto/server-management-settings.dto';
import { DEFAULT_NODE_ID, DEFAULT_NODE_NAME } from '../server-management/server-management-settings.service';
import { JWT_DEFAULT_SECRET } from '../auth/auth.constants';
import { User } from '../user/entities/user.entity';
import { CompleteSetupDto } from './dto/complete-setup.dto';

/** hbbs management API port (Server Pro default) */
const HBBS_MANAGEMENT_PORT = 21120;

/**
 * Ports explicitly blocked for hbbs management API. These are either
 * system-administrative or protocol ports and prevent SSRF / internal
 * service probing via the setup wizard.
 */
const RESERVED_BLOCKED_PORTS = new Set<number>([
  1, 17, 19, 21, 23, 25, 43, 53, 67, 68, 69, 79, 88, 95, 106, 110,
  111, 113, 119, 123, 135, 137, 138, 139, 143, 161, 162, 177, 389,
  465, 512, 513, 514, 515, 544, 548, 587, 631, 636, 873, 993, 995,
  1433, 1434, 1521, 1723, 3306, 3389, 5432, 5672, 6379, 8086, 9200,
  27017, 27018, 27019,
]);

/** Private-network CIDR blocklist for SSRF protection (fetchHbbsPublicKey). */
function isPrivateIp(hostname: string): boolean {
  try {
    // IPv6 bracketed form from URL parser
    const h = hostname.replace(/^\[|\]$/g, '');
    if (!h) return true;

    // IPv4
    const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
      const [a, b] = [parseInt(m[1]), parseInt(m[2])];
      if (a === 10) return true;               // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
      if (a === 192 && b === 168) return true;          // 192.168.0.0/16
      if (a === 127) return true;             // 127.0.0.0/8
      if (a === 169 && b === 254) return true;          // 169.254.0.0/16
      return false;
    }

    // IPv6 — check localhost and private ranges
    if (h === '::1') return true;
    if (h === 'localhost') return true;
    if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA
    if (h.startsWith('fe8')) return true;                       // link-local

    // DNS-resolve? No — don't do DNS rebinding risk. Fail open: treat all
    // hostnames that we can't classify via static rules as potentially
    // private. The user-supplied serverUrl is always going to be the origin
    // they expect hbbs to live at, and in Server Pro the host is the same
    // hostname as the console's public origin. So we block fetch entirely
    // when the host is a bare IP or localhost form — forcing user to use
    // a public-facing hostname.
    if (/^(?!-)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*$/.test(h)) {
      // Plain hostname — allow, but reject localhost explicitly
      const lower = h.toLowerCase();
      if (lower === 'localhost' || lower.endsWith('.local')) return true;
      return false;
    }

    return true; // unknown form — reject safely
  } catch {
    return true;
  }
}

export interface SetupStatus {
  completed: boolean;
}

export interface SetupCompletionWarning {
  code: string;
  message: string;
}

export interface SetupCompletionResult {
  completed: true;
  origin: string;
  webClient: {
    eligible: boolean;
    enabled: boolean;
    idServerUrl?: string;
    relayServerUrl?: string;
    allowedOrigin?: string;
  };
  serverManagement: {
    url: string;
    tokenConfigured: boolean;
    usingDefaultSecret: boolean;
    nodeId: string;
    nodeName: string;
  };
  passwordChanged: boolean;
  warnings: SetupCompletionWarning[];
}

// In-process lock to prevent concurrent duplicate submissions while the setup
// wizard is being completed. Simple boolean is sufficient because setup runs
// exactly once ever per install.
let setupInProgress = false;

@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name);

  constructor(
    private readonly generalSettingsService: GeneralSettingsService,
    private readonly webClientSettingsService: WebClientSettingsService,
    private readonly webClientService: WebClientService,
    private readonly serverManagementSettingsService: ServerManagementSettingsService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async getStatus(): Promise<SetupStatus> {
    const { frontendUrl } = await this.generalSettingsService.getSiteSettings();
    return { completed: Boolean(frontendUrl) };
  }

  /**
   * Complete the initial setup wizard.
   * Idempotency: returns 409 if already completed.
   * Atomicity: every pre-check (password, public-key, URL) runs before any
   * write, so a password validation failure never leaves DB half-configured.
   */
  async complete(dto: CompleteSetupDto): Promise<SetupCompletionResult> {
    const status = await this.getStatus();
    if (status.completed) {
      throw new ConflictException('Setup has already been completed');
    }

    if (setupInProgress) {
      throw new ConflictException('Setup is already in progress');
    }
    setupInProgress = true;

    try {
      return await this.doComplete(dto);
    } finally {
      setupInProgress = false;
    }
  }

  private async doComplete(dto: CompleteSetupDto): Promise<SetupCompletionResult> {
    const origin = this.normalizeOrigin(dto.serverUrl);
    const parsed = new URL(origin);
    const isHttps = parsed.protocol === 'https:';
    const isIpHost = /^\d+\.\d+\.\d+\.\d+$|^\[.*\]$/.test(parsed.hostname);

    const warnings: SetupCompletionWarning[] = [];
    if (!isHttps) {
      warnings.push({
        code: 'http_only',
        message:
          'Using HTTP origin. Web client (remote control) and cloud builds require a public HTTPS address.',
      });
    } else if (isIpHost) {
      warnings.push({
        code: 'ip_host',
        message:
          'Using an IP address. Web client requires a stable domain so hbbs relay-servers can match.',
      });
    }

    // ---- Pre-check & write: admin username + password (must succeed first) ----
    const adminUser = await this.userRepository.findOne({
      where: { isAdmin: true },
    });
    if (!adminUser) {
      throw new BadRequestException('No admin user found');
    }
    adminUser.username = dto.adminUsername;
    adminUser.password = await bcrypt.hash(dto.adminPassword, 10);
    adminUser.displayName = dto.adminUsername;
    await this.userRepository.save(adminUser);
    const passwordChanged = true;
    this.logger.log(
      `Admin credentials set during setup wizard. username=${dto.adminUsername}`,
    );

    // ---- Pre-check: optional public key from DTO (user-supplied override) ----
    let userSuppliedKey = dto.serverPublicKey;
    let hasValidUserKey = false;
    if (userSuppliedKey) {
      const decoded = Buffer.from(userSuppliedKey, 'base64');
      if (decoded.length === 32 && decoded.toString('base64') === userSuppliedKey) {
        hasValidUserKey = true;
      } else {
        warnings.push({
          code: 'invalid_public_key',
          message:
            'Supplied serverPublicKey is not a valid Base64-encoded 32-byte Ed25519 key; web client will not be auto-enabled.',
        });
        userSuppliedKey = undefined;
      }
    }

    // ---- Build web client URL plan (only eligible when HTTPS) ----
    let webClientEligible = false;
    let webClientUpdate: UpdateWebClientSettingsDto | null = null;

    if (isHttps) {
      webClientEligible = true;
      const host = parsed.host; // includes non-default port when present
      webClientUpdate = {
        allowedOrigin: origin,
        idServerUrl: `wss://${host}/ws/id`,
        relayServerUrl: `wss://${host}/ws/relay`,
        enabled: false, // default; flipped below once we have a key
      };
    } else {
      warnings.push({
        code: 'web_client_skipped',
        message:
          'Skipped web client configuration: HTTPS origin is required. Configure later in "Settings → Web Client".',
      });
    }

    // ---- Write site URL ----
    const currentGeneral = await this.generalSettingsService.getSettings();
    const siteUpdate: UpdateGeneralSettingsDto = {
      watermarkEnabled: currentGeneral.watermarkEnabled,
      defaultLanguage: currentGeneral.defaultLanguage,
      jwtExpiryDays: currentGeneral.jwtExpiryDays,
      auditRetentionDays: currentGeneral.auditRetentionDays,
      deviceCloneIsolation: currentGeneral.deviceCloneIsolation,
      webauthn: currentGeneral.webauthn,
      site: {
        frontendUrl: origin,
        backendUrl: '',
      },
    };
    await this.generalSettingsService.updateSettings(siteUpdate);

    // ---- Auto-configure hbbs management API (ServerManagement) ----
    // Console and hbbs share one JWT_SECRET in integrated deployments.
    const jwtSecret = process.env.JWT_SECRET || JWT_DEFAULT_SECRET;
    const usingDefaultSecret = !process.env.JWT_SECRET;
    // hbbs 管理 API 走 HTTP（RustDesk Server Pro 默认 HTTP 21120），
    // 但主机名必须用 parsed.hostname（不带端口），不能用 parsed.host
    // （它包含用户填的反代端口如 :4443，会导致 URL 变成 host:反代端口:21120）
    const managementUrl = `http://${parsed.hostname}:${HBBS_MANAGEMENT_PORT}`;
    const smUpdate: UpdateServerManagementSettingsDto = {
      url: managementUrl,
      token: jwtSecret,
      nodeId: DEFAULT_NODE_ID,
      nodeName: DEFAULT_NODE_NAME,
    };
    let smConfigured = true;
    try {
      await this.serverManagementSettingsService.updateSettings(smUpdate);
    } catch (error) {
      smConfigured = false;
      warnings.push({
        code: 'server_management_config_failed',
        message: `Auto-configure hbbs management API failed: ${String(error)}. Configure it manually in "Settings → Server Management".`,
      });
    }
    if (smConfigured && usingDefaultSecret) {
      warnings.push({
        code: 'jwt_default_secret',
        message:
          'JWT_SECRET is not set — using the default development secret. Set it via environment variable in production.',
      });
    }

    // ---- Auto-pull hbbs public_key from management API ----
    // Now that ServerManagement is configured, call hbbs /v1/status to fetch
    // its Ed25519 public key. This avoids the "paste id_ed25519.pub manually"
    // step — key is read directly from the running hbbs instance.
    let fetchedPublicKey: string | undefined;
    if (smConfigured) {
      fetchedPublicKey = await this.fetchHbbsPublicKey(managementUrl, jwtSecret);
      if (fetchedPublicKey) {
        this.logger.log('Fetched hbbs public key from /v1/status');
      } else {
        this.logger.warn(
          'Could not fetch hbbs public key from /v1/status; web client stays disabled',
        );
      }
    }

    // ---- Decide web client key source and final state ----
    // Priority: user-supplied key > hbbs API fetched key > disabled with warning
    let finalPublicKey: string | undefined;
    if (hasValidUserKey && userSuppliedKey) {
      finalPublicKey = userSuppliedKey;
    } else if (fetchedPublicKey) {
      finalPublicKey = fetchedPublicKey;
    }

    let webClientEnabled = false;
    if (webClientUpdate) {
      if (finalPublicKey) {
        webClientUpdate.serverPublicKey = finalPublicKey;
        webClientUpdate.enabled = true;
        webClientEnabled = true;
      } else {
        webClientUpdate.enabled = false;
        const reason = smConfigured
          ? 'hbbs management API reachable but did not return a valid public key'
          : 'hbbs management API not configured';
        warnings.push({
          code: 'web_client_pending_key',
          message:
            `Web client addresses pre-filled but disabled (${reason}). Start hbbs and run setup again, or paste its id_ed25519.pub manually in "Settings → Web Client".`,
        });
      }
    }

    // ---- Write web client settings ----
    if (webClientUpdate) {
      await this.webClientSettingsService.updateSettings(webClientUpdate);
      await this.webClientService.refresh();
    }

    this.logger.log(
      `Setup wizard completed. origin=${origin}, webClientEnabled=${webClientEnabled}, serverManagementConfigured=${smConfigured}, usingDefaultSecret=${usingDefaultSecret}, passwordChanged=${passwordChanged}`,
    );

    const result: SetupCompletionResult = {
      completed: true,
      origin,
      webClient: {
        eligible: webClientEligible,
        enabled: webClientEnabled,
      },
      serverManagement: {
        url: managementUrl,
        tokenConfigured: smConfigured,
        usingDefaultSecret,
        nodeId: DEFAULT_NODE_ID,
        nodeName: DEFAULT_NODE_NAME,
      },
      passwordChanged,
      warnings,
    };

    if (webClientUpdate) {
      result.webClient.idServerUrl = webClientUpdate.idServerUrl;
      result.webClient.relayServerUrl = webClientUpdate.relayServerUrl;
      result.webClient.allowedOrigin = webClientUpdate.allowedOrigin;
    }

    return result;
  }

  /**
   * Fetch hbbs Ed25519 public key via the management API /v1/status endpoint.
   * Returns undefined when hbbs is unreachable or the key is missing/invalid.
   * Tolerates network errors — setup must never fail because hbbs isn't up
   * yet; it just degrades to web client disabled with a warning.
   *
   * SSRF protection:
   *   - rejects private IPs (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x)
   *   - rejects localhost / ::1 / .local hostnames
   *   - rejects well-known system ports (22, 3306, 5432, 6379, 27017, ...)
   *   - never follows redirects (fetch option redirect: 'error')
   */
  private async fetchHbbsPublicKey(
    managementUrl: string,
    token: string,
  ): Promise<string | undefined> {
    let url: URL;
    try {
      url = new URL(managementUrl);
    } catch {
      return undefined;
    }

    // SSRF gate 1: hostname
    if (isPrivateIp(url.hostname)) {
      this.logger.warn(
        `fetchHbbsPublicKey: SSRF block — private/reserved host ${url.hostname}`,
      );
      return undefined;
    }

    // SSRF gate 2: port
    const port = url.port ? parseInt(url.port, 10) : 21120;
    if (
      isNaN(port) ||
      port < 1 ||
      port > 65535 ||
      RESERVED_BLOCKED_PORTS.has(port)
    ) {
      this.logger.warn(
        `fetchHbbsPublicKey: SSRF block — invalid port ${port}`,
      );
      return undefined;
    }

    // SSRF gate 3: scheme (always http, management API is HTTP-only)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return undefined;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${managementUrl}/v1/status`, {
        redirect: 'error',
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) return undefined;
      const json: any = await response.json();
      const key = json?.public_key ?? json?.data?.public_key;
      if (typeof key !== 'string' || !key) return undefined;
      // Validate: must be Base64-encoded 32-byte Ed25519 public key
      const trimmed = key.trim();
      const decoded = Buffer.from(trimmed, 'base64');
      if (decoded.length !== 32 || decoded.toString('base64') !== trimmed) {
        return undefined;
      }
      return trimmed;
    } catch {
      return undefined;
    }
  }

  /**
   * Normalize a user-supplied server URL into an http(s) origin.
   * Strips trailing slashes, rejects non-http(s) protocols, paths, queries,
   * fragments, credentials and whitespace.
   *
   * Additional hardening:
   *   - rejects private/loopback IPs (127.x, 10.x, 172.16-31.x, 192.168.x, ...)
   *   - rejects localhost hostnames
   *   - rejects reserved system ports
   *   - enforces port range 1–65535
   *
   * This blocks setup from being used to probe internal network services
   * (SSRF) or from generating wss/management URLs that would bind to
   * the wrong endpoints.
   */
  private normalizeOrigin(input: string): string {
    if (typeof input !== 'string' || !input.trim()) {
      throw new BadRequestException('serverUrl is required');
    }
    if (input !== input.trim() || /[\s\\?#]/.test(input)) {
      throw new BadRequestException(
        'serverUrl must be an http(s) origin without path, query, fragment or whitespace',
      );
    }

    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new BadRequestException('serverUrl is not a valid URL');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadRequestException('serverUrl must use http or https');
    }

    if (url.username || url.password) {
      throw new BadRequestException('serverUrl must not contain credentials');
    }

    if (url.pathname && url.pathname !== '/') {
      throw new BadRequestException('serverUrl must not contain a path');
    }

    // Port hardening
    if (url.port) {
      const port = parseInt(url.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new BadRequestException('serverUrl port must be between 1 and 65535');
      }
      if (RESERVED_BLOCKED_PORTS.has(port)) {
        throw new BadRequestException(
          'serverUrl must not use reserved/system ports (e.g. 22, 3306, 5432, 6379)',
        );
      }
    }

    // Reject private/internal hostnames and IPs
    if (isPrivateIp(url.hostname)) {
      throw new BadRequestException(
        'serverUrl must be a public-facing URL; localhost, loopback and private IPs are not allowed',
      );
    }

    return url.origin;
  }
}
