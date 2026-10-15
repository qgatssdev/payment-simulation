import { ConfigError, loadConfig } from './configuration';

describe('loadConfig', () => {
  it('needs nothing: every value has a working default', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      LOG_LEVEL: 'info',
      CORS_ORIGINS: ['http://localhost:3000'],
      TRUST_PROXY: 0,
      RATE_LIMIT_MAX: 300,
      DATA_FILE: './data/payments.json',
      WORKER_ENABLED: true,
    });
    expect(config.isProduction).toBe(false);
    expect(config.buildSha).toBe('dev');
  });

  it('coerces numbers and booleans and splits comma-separated origins', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      PORT: '8080',
      TRUST_PROXY: '1',
      WORKER_ENABLED: 'false',
      GATEWAY_DECLINE_RATE: '0.25',
      CORS_ORIGINS: 'https://pay.example.com, http://localhost:3000 ,',
      RENDER_GIT_COMMIT: 'abcdef0123456789',
    });
    expect(config).toMatchObject({
      PORT: 8080,
      TRUST_PROXY: 1,
      WORKER_ENABLED: false,
      GATEWAY_DECLINE_RATE: 0.25,
      CORS_ORIGINS: ['https://pay.example.com', 'http://localhost:3000'],
    });
    expect(config.isProduction).toBe(true);
    expect(config.buildSha).toBe('abcdef0');
  });

  it('accepts an empty DATA_FILE for in-memory mode', () => {
    expect(loadConfig({ DATA_FILE: '' }).DATA_FILE).toBe('');
  });

  it('ignores unrelated environment variables', () => {
    const config = loadConfig({ HOME: '/Users/x', isProduction: 'true' });
    expect(config).not.toHaveProperty('HOME');
    expect(config.isProduction).toBe(false);
  });

  it('reports every invalid value at once', () => {
    let error: unknown;
    try {
      loadConfig({ PORT: 'eighty', LOG_LEVEL: 'loud', GATEWAY_DECLINE_RATE: '2' });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const fields = (error as ConfigError).issues.map((i) => i.split(':')[0]);
    expect(fields.sort()).toEqual(['GATEWAY_DECLINE_RATE', 'LOG_LEVEL', 'PORT']);
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(loadConfig({}))).toBe(true);
  });
});
