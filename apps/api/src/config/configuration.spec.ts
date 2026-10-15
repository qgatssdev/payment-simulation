import { ConfigError, loadConfig } from './configuration';

const DB = 'postgresql://user:pass@ep-quiet-sky.neon.tech/payments?sslmode=require';

describe('loadConfig', () => {
  it('applies defaults when only the required values are set', () => {
    const config = loadConfig({ DATABASE_URL: DB });
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      LOG_LEVEL: 'info',
      CORS_ORIGINS: ['http://localhost:3000'],
      TRUST_PROXY: 0,
      RATE_LIMIT_MAX: 300,
    });
    expect(config.isProduction).toBe(false);
    expect(config.buildSha).toBe('dev');
  });

  it('coerces numbers and splits comma-separated origins', () => {
    const config = loadConfig({
      DATABASE_URL: DB,
      NODE_ENV: 'production',
      PORT: '8080',
      TRUST_PROXY: '1',
      CORS_ORIGINS: 'https://pay.example.com, http://localhost:3000 ,',
      RENDER_GIT_COMMIT: 'abcdef0123456789',
    });
    expect(config.PORT).toBe(8080);
    expect(config.TRUST_PROXY).toBe(1);
    expect(config.CORS_ORIGINS).toEqual([
      'https://pay.example.com',
      'http://localhost:3000',
    ]);
    expect(config.isProduction).toBe(true);
    expect(config.buildSha).toBe('abcdef0');
  });

  it('falls back to the pooled URL when no unpooled URL is given', () => {
    expect(
      loadConfig({ DATABASE_URL: DB, DATABASE_URL_UNPOOLED: '' }).databaseUrlUnpooled,
    ).toBe(DB);
    const direct = DB.replace('ep-quiet-sky', 'ep-quiet-sky-direct');
    expect(
      loadConfig({ DATABASE_URL: DB, DATABASE_URL_UNPOOLED: direct }).databaseUrlUnpooled,
    ).toBe(direct);
  });

  it('ignores unrelated environment variables', () => {
    const config = loadConfig({
      DATABASE_URL: DB,
      HOME: '/Users/x',
      isProduction: 'true',
    });
    expect(config).not.toHaveProperty('HOME');
    expect(config.isProduction).toBe(false);
  });

  it('reports every invalid value at once', () => {
    let error: unknown;
    try {
      loadConfig({ PORT: 'eighty', LOG_LEVEL: 'loud', DATABASE_URL: 'mysql://nope' });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const fields = (error as ConfigError).issues.map((i) => i.split(':')[0]);
    expect(fields.sort()).toEqual(['DATABASE_URL', 'LOG_LEVEL', 'PORT']);
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(loadConfig({ DATABASE_URL: DB }))).toBe(true);
  });
});
