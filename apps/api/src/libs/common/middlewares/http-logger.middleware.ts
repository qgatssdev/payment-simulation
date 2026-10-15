import type { RequestHandler } from 'express';
import type { Logger } from '../../core/logger/logger';
import { requestContext } from '../../core/logger/request-context';

const PROBE_PATHS = new Set(['/health', '/ready']);

/** One structured line per request, written when the response finishes or the client aborts. */
export function httpLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.once('close', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const status = res.statusCode;
      const aborted = !res.writableFinished;
      const level = aborted
        ? 'warn'
        : status >= 500
          ? 'error'
          : status >= 400
            ? 'warn'
            : PROBE_PATHS.has(req.path)
              ? 'debug'
              : 'info';

      // 'close' fires outside the request's async context; re-enter it so the mixin adds the id.
      requestContext.run({ requestId: req.id }, () => {
        logger[level](
          {
            method: req.method,
            url: req.originalUrl,
            status,
            durationMs: Math.round(durationMs * 10) / 10,
            ip: req.ip,
          },
          aborted ? 'request aborted' : 'request completed',
        );
      });
    });

    next();
  };
}
