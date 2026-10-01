import { DataSource } from 'typeorm';
import { OidcAuthState, OidcAuthStatus } from './oidc-auth-state.entity';
import { OidcProvider, OidcProviderType } from './oidc-provider.entity';

describe('OIDC database defaults', () => {
  let database: DataSource;
  beforeEach(async () => {
    database = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [OidcProvider, OidcAuthState],
      synchronize: true,
    });
    await database.initialize();
  });
  afterEach(async () => {
    if (database?.isInitialized) await database.destroy();
  });

  async function seed() {
    await database.getRepository(OidcProvider).insert({
      guid: 'provider',
      name: 'Provider',
      issuer: 'https://issuer.example.invalid',
      clientId: 'client',
    });
    await database.getRepository(OidcAuthState).insert({
      guid: 'state',
      code: 'test-code',
      op: 'oidc/provider',
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    });
  }
  async function expectDefaults() {
    const provider = await database
      .getRepository(OidcProvider)
      .findOneByOrFail({ guid: 'provider' });
    const state = await database
      .getRepository(OidcAuthState)
      .findOneByOrFail({ guid: 'state' });
    expect(provider.type).toBe(OidcProviderType.OIDC);
    expect(state.providerType).toBe(OidcProviderType.OIDC);
    expect(state.status).toBe(OidcAuthStatus.PENDING);
  }
  it('retains all three defaults on omitted inserts and repeated SQLite startup', async () => {
    await seed();
    await expectDefaults();
    await database.synchronize();
    await expectDefaults();
    expect(await database.driver.createSchemaBuilder().log()).toMatchObject({
      upQueries: [],
    });
  });
  it('preserves rows when adopting the previous SQLite literal-default schema', async () => {
    const columns = [
      database.getMetadata(OidcProvider).findColumnWithPropertyName('type')!,
      database
        .getMetadata(OidcAuthState)
        .findColumnWithPropertyName('providerType')!,
      database.getMetadata(OidcAuthState).findColumnWithPropertyName('status')!,
    ];
    const expressions = columns.map((column) => column.default);
    for (const [index, column] of columns.entries())
      column.default =
        index === 2 ? OidcAuthStatus.PENDING : OidcProviderType.OIDC;
    await database.synchronize();
    await seed();
    await database
      .getRepository(OidcAuthState)
      .update('state', { status: OidcAuthStatus.AUTHORIZED });
    for (const [index, column] of columns.entries())
      column.default = expressions[index];
    await database.synchronize();
    expect(await database.getRepository(OidcProvider).count()).toBe(1);
    const state = await database
      .getRepository(OidcAuthState)
      .findOneByOrFail({ guid: 'state' });
    expect(state.status).toBe(OidcAuthStatus.AUTHORIZED);
    expect(state.code).toBe('test-code');
  });
  it('emits MySQL expression defaults for TEXT without changing column types', () => {
    const mysql = new DataSource({
      type: 'mysql',
      database: 'unused',
      entities: [OidcProvider, OidcAuthState],
    });
    for (const [entity, property, expected] of [
      [OidcProvider, 'type', OidcProviderType.OIDC],
      [OidcAuthState, 'providerType', OidcProviderType.OIDC],
      [OidcAuthState, 'status', OidcAuthStatus.PENDING],
    ] as const) {
      const column = database
        .getMetadata(entity)
        .findColumnWithPropertyName(property)!;
      expect(column.type).toBe('text');
      expect(mysql.driver.normalizeDefault(column)).toBe(
        "('" + expected + "')",
      );
    }
  });
});
