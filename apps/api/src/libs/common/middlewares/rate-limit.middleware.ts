import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { RateLimitError } from '../../core/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface RateLimitOptions {
  windowMs: number;
  limit: number;
  /** Count only state-changing requests (POST/PATCH/...). */
  writesOnly?: boolean;
}

/** In-memory, per-instance limits. Several instances would need a shared store (e.g. Redis). */
export function createRateLimiter({
  windowMs,
  limit,
  writesOnly = false,
}: RateLimitOptions): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: writesOnly ? 'writes' : 'all',
    skip: writesOnly ? (req) => SAFE_METHODS.has(req.method) : undefined,
    handler: (_req, _res, next) => next(new RateLimitError()),
  });
}
