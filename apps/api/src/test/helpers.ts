import { Writable } from 'node:stream';
import type { Router } from 'express';
import express from 'express';
import { createApp } from '../app';
import type { Configuration } from '../config';
import { loadConfig } from '../config';
import type { Logger } from '../libs/core/logger/logger';
import { createLogger } from '../libs/core/logger/logger';
import type { ReadinessCheck } from '../modules/health/services/health.service';
import { HealthService } from '../modules/health/services/health.service';

export function testConfig(env: NodeJS.ProcessEnv = {}): Readonly<Configuration> {
  return loadConfig({
    NODE_ENV: 'test',
    // In memory unless a test opts into a file: nothing touches the working directory.
    DATA_FILE: '',
    ...env,
  });
}

/** A logger whose JSON lines are captured in memory for assertions. */
export function captureLogger(level = 'debug'): {
  logger: Logger;
  lines: () => Array<Record<string, unknown>>;
} {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    logger: createLogger({ level, pretty: false }, stream),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

export interface TestAppOptions {
  env?: NodeJS.ProcessEnv;
  routes?: (router: Router) => void;
  checks?: ReadinessCheck[];
  logger?: Logger;
}

export function buildTestApp({ env, routes, checks = [], logger }: TestAppOptions = {}) {
  const config = testConfig(env);
  const log = logger ?? createLogger({ level: 'silent', pretty: false });
  const apiRouter = express.Router();
  routes?.(apiRouter);
  return createApp({
    config,
    logger: log,
    healthService: new HealthService(checks, log, 'test', 50),
    apiRouter,
  });
}
