import 'reflect-metadata';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
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

const bool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

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
  @Min(1)
  @Max(100)
  DATABASE_POOL_MAX = 10;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  DATABASE_STATEMENT_TIMEOUT_MS = 10_000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  DATABASE_SLOW_QUERY_MS = 500;

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

  // --- Payment worker -------------------------------------------------------------------

  /** Run the job worker in this process. Disable to run API-only instances. */
  @Transform(bool)
  @IsBoolean()
  WORKER_ENABLED = true;

  /** Jobs processed in parallel per process. Keep below DATABASE_POOL_MAX. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  WORKER_CONCURRENCY = 4;

  @Type(() => Number)
  @IsInt()
  @Min(10)
  WORKER_POLL_INTERVAL_MS = 1_000;

  /** A running job whose lock is older than this is presumed orphaned and re-queued. */
  @Type(() => Number)
  @IsInt()
  @Min(1_000)
  WORKER_LOCK_TIMEOUT_MS = 60_000;

  /** Gateway attempts per payment, including the first. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  JOB_MAX_ATTEMPTS = 4;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  RETRY_BASE_DELAY_MS = 1_000;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  RETRY_MAX_DELAY_MS = 30_000;

  // --- Simulated gateway ----------------------------------------------------------------

  @Type(() => Number)
  @IsInt()
  @Min(0)
  GATEWAY_MIN_LATENCY_MS = 300;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  GATEWAY_MAX_LATENCY_MS = 2_500;

  /** Per-attempt deadline; a slower gateway response counts as a retryable timeout. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  GATEWAY_TIMEOUT_MS = 3_000;

  /** For cards that are not test cards: share of charges declined outright. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  GATEWAY_DECLINE_RATE = 0.1;

  /** For cards that are not test cards: share of attempts failing with a retryable error. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  GATEWAY_TRANSIENT_ERROR_RATE = 0.15;

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
