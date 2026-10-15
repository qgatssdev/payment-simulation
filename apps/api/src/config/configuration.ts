import 'reflect-metadata';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;
const NODE_ENVS = ['development', 'test', 'production'] as const;
const POSTGRES_URL = { protocols: ['postgres', 'postgresql'], require_tld: false };

const csv = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : value;

const emptyToUndefined = ({ value }: { value: unknown }): unknown =>
  value === '' ? undefined : value;

/**
 * Environment contract, validated once at boot. Adapted from the nest-template's
 * Configuration class, but built from an explicit env object instead of a module-level
 * singleton so tests can construct any configuration they need.
 */
export class Configuration {
  @IsIn(NODE_ENVS)
  NODE_ENV: (typeof NODE_ENVS)[number] = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(65535)
  PORT = 4000;

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: (typeof LOG_LEVELS)[number] = 'info';

  @Transform(csv)
  @IsUrl({ require_tld: false }, { each: true })
  CORS_ORIGINS: string[] = ['http://localhost:3000'];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  TRUST_PROXY = 0;

  @IsUrl(POSTGRES_URL)
  DATABASE_URL!: string;

  /** Direct (non-pooled) connection, required by LISTEN/NOTIFY. Falls back to DATABASE_URL. */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUrl(POSTGRES_URL)
  DATABASE_URL_UNPOOLED?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  RATE_LIMIT_WINDOW_MS = 60_000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_MAX = 300;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_WRITE_MAX = 60;

  @IsString()
  BODY_LIMIT = '16kb';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  SHUTDOWN_TIMEOUT_MS = 10_000;

  /** Set by Render at build time; surfaced on /health so you can tell which build answered. */
  @IsOptional()
  @IsString()
  RENDER_GIT_COMMIT?: string;

  get isProduction(): boolean {
    return this.NODE_ENV === 'production';
  }

  get databaseUrlUnpooled(): string {
    return this.DATABASE_URL_UNPOOLED ?? this.DATABASE_URL;
  }

  get buildSha(): string {
    return this.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'dev';
  }
}

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

const ENV_KEY = /^[A-Z][A-Z0-9_]*$/;

/**
 * Only decorated keys survive (`whitelist`), so the rest of the environment is ignored.
 * Non-env-style keys are dropped up front so nothing can collide with the class's getters.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): Readonly<Configuration> {
  const candidates = Object.fromEntries(
    Object.entries(env).filter(
      ([key, value]) => ENV_KEY.test(key) && value !== undefined,
    ),
  );
  const config = plainToInstance(Configuration, candidates, {
    exposeDefaultValues: true,
  });
  const errors = validateSync(config, { whitelist: true });
  if (errors.length > 0) {
    throw new ConfigError(
      errors.map(
        (e) => `${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`,
      ),
    );
  }
  return Object.freeze(config);
}
