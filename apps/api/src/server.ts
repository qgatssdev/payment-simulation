import 'reflect-metadata';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { createApp } from './app';
import { ConfigError, loadConfig } from './config';
import { createContainer } from './container';
import type { Logger } from './libs/core/logger/logger';
import { createLogger } from './libs/core/logger/logger';

// Local convenience only; deployed environments inject real variables.
if (existsSync('.env')) process.loadEnvFile('.env');

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // No logger yet: the logger's own settings come from this config.
    console.error(err instanceof ConfigError ? err.message : err);
    process.exit(1);
  }

  const logger = createLogger({
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === 'development',
  });
  registerProcessHandlers(logger);

  let container;
  try {
    container = await createContainer(config, logger);
  } catch (err) {
    logger.fatal({ err }, 'startup failed');
    process.exit(1);
  }
  const app = createApp(container);

  const server = app.listen(config.PORT, () => {
    if (config.WORKER_ENABLED) container.worker.start();
    logger.info(
      { port: config.PORT, env: config.NODE_ENV, version: config.buildSha },
      'listening',
    );
  });
  // Outlive the load balancer's idle timeout so it never reuses a socket we already closed.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  registerShutdown(
    server,
    () => container.shutdown(),
    logger,
    config.SHUTDOWN_TIMEOUT_MS,
  );
}

function registerShutdown(
  server: Server,
  releaseResources: () => Promise<void>,
  logger: Logger,
  timeoutMs: number,
): void {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const force = setTimeout(() => {
      logger.error({ timeoutMs }, 'graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, timeoutMs);
    force.unref();

    try {
      // Stop accepting connections and let in-flight requests finish.
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeIdleConnections();
      });
      await releaseResources();
      logger.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.once('SIGTERM', (signal) => void shutdown(signal));
  process.once('SIGINT', (signal) => void shutdown(signal));
}

/** Fail fast: state after an unhandled error is unknown, so log it and let the platform restart us. */
function registerProcessHandlers(logger: Logger): void {
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });
}

void main();
