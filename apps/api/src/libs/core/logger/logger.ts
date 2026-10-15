import type { DestinationStream, Logger, LoggerOptions } from 'pino';
import pino from 'pino';
import { requestContext } from './request-context';

export type { Logger } from 'pino';

/** Card data must never reach the logs, wherever it ends up nested. */
export const REDACT_PATHS = [
  'card.number',
  'card.cvc',
  '*.card.number',
  '*.card.cvc',
  'req.headers.authorization',
  'req.headers.cookie',
];

export interface LoggerConfig {
  level: string;
  pretty: boolean;
}

export function createLogger(
  { level, pretty }: LoggerConfig,
  destination?: DestinationStream,
): Logger {
  const options: LoggerOptions = {
    level,
    base: { service: 'payment-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    mixin: () => ({ ...requestContext.get() }),
    formatters: { level: (label) => ({ level: label }) },
  };

  if (pretty && !destination) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,service' },
      },
    });
  }
  return destination ? pino(options, destination) : pino(options);
}
