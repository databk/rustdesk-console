// Hoisted to top of file by Jest — must come before any import statements
jest.mock('../settings/services/general-settings.service', () => ({}));
jest.mock('../web-client/web-client-settings.service', () => ({}));
jest.mock('../web-client/web-client.service', () => ({}));
jest.mock('../server-management/server-management-settings.service', () => ({
  DEFAULT_NODE_ID: 'rustdesk',
  DEFAULT_NODE_NAME: 'RustDesk',
}));

import { ConflictException, BadRequestException } from '@nestjs/common';
import { SetupService } from './setup.service';
import { CompleteSetupDto } from './dto/complete-setup.dto';

const VALID_PUBLIC_KEY = Buffer.alloc(32, 7).toString('base64');
const BASE_DTO = {
  serverUrl: 'https://rdc.tmnas.top',
  adminUsername: 'admin',
  adminPassword: 'admin123',
};

describe('SetupService', () => {
  let service: SetupService;
  let mockGeneralSettings: any;
  let mockWebClientSettings: any;
  let mockWebClient: any;
  let mockServerManagementSettings: any;
  let mockUserRepo: any;

  const adminUser = {
    guid: 'admin-guid',
    username: 'databk',
    isAdmin: true,
    save: jest.fn().mockReturnThis(),
  };

  const createService = () => {
    mockGeneralSettings = {
      getSiteSettings: jest.fn(),
      getSettings: jest.fn(),
      updateSettings: jest.fn(),
    };
    mockWebClientSettings = { updateSettings: jest.fn() };
    mockWebClient = { refresh: jest.fn() };
    mockServerManagementSettings = { updateSettings: jest.fn() };
    mockUserRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    mockUserRepo.findOne.mockResolvedValue(adminUser);
    mockUserRepo.save.mockResolvedValue({ ...adminUser, username: 'admin' });

    service = new SetupService(
      mockGeneralSettings,
      mockWebClientSettings,
      mockWebClient,
      mockServerManagementSettings,
      mockUserRepo,
    );
  };

  const freshSiteSettings = () => ({
    frontendUrl: '',
    backendUrl: '',
    effectiveFrontendUrl: 'http://localhost:3000',
    effectiveBackendUrl: 'http://localhost:3000',
  });

  const freshGeneralSettings = () => ({
    watermarkEnabled: true,
    defaultLanguage: 'en-US',
    jwtExpiryDays: 30,
    auditRetentionDays: 0,
    deviceCloneIsolation: false,
    site: { frontendUrl: '', backendUrl: '' },
    webauthn: { enabled: true, rpName: 'RustDesk Console' },
  });

  beforeEach(() => {
    createService();
    mockGeneralSettings.getSiteSettings.mockResolvedValue(freshSiteSettings());
    mockGeneralSettings.getSettings.mockResolvedValue(freshGeneralSettings());
    // Mock global.fetch — SetupService.fetchHbbsPublicKey calls hbbs /v1/status
    // to auto-pull the Ed25519 key. Most tests don't need that path, so make
    // fetch fail fast (returns ok:false → key stays undefined → web client
    // stays disabled unless the test supplies its own serverPublicKey).
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
  });

  // ---------- Status detection ----------

  it('reports completed=false when no frontendUrl is configured', async () => {
    mockGeneralSettings.getSiteSettings.mockResolvedValue(freshSiteSettings());
    await expect(service.getStatus()).resolves.toEqual({ completed: false });
  });

  it('reports completed=true when frontendUrl is already set (upgrade path)', async () => {
    mockGeneralSettings.getSiteSettings.mockResolvedValue({
      ...freshSiteSettings(),
      frontendUrl: 'https://rdc.tmnas.top',
    });
    await expect(service.getStatus()).resolves.toEqual({ completed: true });
  });

  // ---------- Idempotency ----------

  it('rejects POST with 409 when setup is already completed', async () => {
    mockGeneralSettings.getSiteSettings.mockResolvedValue({
      ...freshSiteSettings(),
      frontendUrl: 'https://rdc.tmnas.top',
    });
    await expect(
      service.complete({ serverUrl: 'https://another.example.com', adminUsername: 'admin', adminPassword: 'admin123' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockGeneralSettings.updateSettings).not.toHaveBeenCalled();
    expect(mockWebClientSettings.updateSettings).not.toHaveBeenCalled();
    expect(mockServerManagementSettings.updateSettings).not.toHaveBeenCalled();
    expect(mockUserRepo.save).not.toHaveBeenCalled();
  });

  // ---------- Invalid URLs ----------

  it('rejects serverUrl with path/query/fragment/non-http(s)/credentials/whitespace', async () => {
    for (const bad of [
      'https://example.com/some/path',
      'https://example.com?x=1',
      'https://example.com#frag',
      'ftp://example.com',
      'https://user:pass@example.com',
      '  https://example.com  ',
    ]) {
      await expect(
        service.complete({ ...BASE_DTO, serverUrl: bad }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(mockGeneralSettings.updateSettings).not.toHaveBeenCalled();
    expect(mockWebClientSettings.updateSettings).not.toHaveBeenCalled();
    expect(mockServerManagementSettings.updateSettings).not.toHaveBeenCalled();
    expect(mockUserRepo.save).not.toHaveBeenCalled();
  });

  // ---------- HTTPS + valid key: full success path ----------

  it('derives web client URLs, enables it, and sets admin credentials', async () => {
    const result = await service.complete({
      ...BASE_DTO,
      serverPublicKey: VALID_PUBLIC_KEY,
    });

    expect(result.completed).toBe(true);
    expect(result.origin).toBe('https://rdc.tmnas.top');
    expect(result.webClient.eligible).toBe(true);
    expect(result.webClient.enabled).toBe(true);
    expect(result.webClient.idServerUrl).toBe('wss://rdc.tmnas.top/ws/id');
    expect(result.webClient.relayServerUrl).toBe('wss://rdc.tmnas.top/ws/relay');
    expect(result.webClient.allowedOrigin).toBe('https://rdc.tmnas.top');
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'jwt_default_secret' }),
      ]),
    );
    expect(result.passwordChanged).toBe(true);

    // Admin credentials written
    expect(adminUser.username).toBe('admin');
    expect(typeof adminUser.password).toBe('string');
    expect(adminUser.password.length).toBeGreaterThan(30); // bcrypt hash
    expect(adminUser.displayName).toBe('admin');
    expect(mockUserRepo.save).toHaveBeenCalled();

    // Site + web client settings
    expect(mockGeneralSettings.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        site: { frontendUrl: 'https://rdc.tmnas.top', backendUrl: '' },
      }),
    );
    expect(mockWebClientSettings.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        allowedOrigin: 'https://rdc.tmnas.top',
        idServerUrl: 'wss://rdc.tmnas.top/ws/id',
        relayServerUrl: 'wss://rdc.tmnas.top/ws/relay',
        serverPublicKey: VALID_PUBLIC_KEY,
      }),
    );
    expect(mockWebClient.refresh).toHaveBeenCalled();

    // ServerManagement auto-configured
    expect(mockServerManagementSettings.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://rdc.tmnas.top:21120',
        nodeId: 'rustdesk',
        nodeName: 'RustDesk',
      }),
    );
    expect(result.serverManagement.url).toBe('http://rdc.tmnas.top:21120');
    expect(result.serverManagement.tokenConfigured).toBe(true);
    expect(result.serverManagement.usingDefaultSecret).toBe(true);
  });

  // ---------- HTTPS + no key: prefilled but disabled ----------

  it('pre-fills web client addresses but keeps disabled when HTTPS but no key', async () => {
    const result = await service.complete({ ...BASE_DTO });

    expect(result.webClient.eligible).toBe(true);
    expect(result.webClient.enabled).toBe(false);
    expect(mockWebClientSettings.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, allowedOrigin: 'https://rdc.tmnas.top' }),
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'web_client_pending_key' }),
      ]),
    );
    expect(result.passwordChanged).toBe(true);
  });

  // ---------- HTTP origin: web client skipped ----------

  it('skips web client config for HTTP origin, emits http_only warning', async () => {
    const result = await service.complete({
      ...BASE_DTO,
      serverUrl: 'http://console.example.com:8080',
      serverPublicKey: VALID_PUBLIC_KEY,
    });

    expect(result.origin).toBe('http://console.example.com:8080');
    expect(result.webClient.eligible).toBe(false);
    expect(result.webClient.enabled).toBe(false);
    expect(mockWebClientSettings.updateSettings).not.toHaveBeenCalled();
    expect(mockWebClient.refresh).not.toHaveBeenCalled();
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'http_only' }),
        expect.objectContaining({ code: 'web_client_skipped' }),
      ]),
    );
    // Admin still written even without HTTPS
    expect(result.passwordChanged).toBe(true);
    expect(mockUserRepo.save).toHaveBeenCalled();
  });

  // ---------- No admin user found ----------

  it('rejects when no admin user exists in DB', async () => {
    mockUserRepo.findOne.mockResolvedValue(null);

    await expect(
      service.complete({ ...BASE_DTO }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mockGeneralSettings.updateSettings).not.toHaveBeenCalled();
    expect(mockWebClientSettings.updateSettings).not.toHaveBeenCalled();
    expect(mockServerManagementSettings.updateSettings).not.toHaveBeenCalled();
    expect(mockUserRepo.save).not.toHaveBeenCalled();
  });
});
