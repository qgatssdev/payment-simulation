import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { HEADERS } from '@payment-sim/shared';
import { requestContext } from '../../core/logger/request-context';

/** Accept a caller's id only if it is short and log-safe; otherwise mint our own. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function assignRequestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get(HEADERS.REQUEST_ID);
    req.id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader(HEADERS.REQUEST_ID, req.id);
    next();
  };
}

/**
 * Enter the request's async context. Mounted after body parsing on purpose: body-parser
 * resumes from stream events that belong to the socket's async resource, so a context
 * entered before it would be lost by the time route handlers run.
 */
export function bindRequestContext(): RequestHandler {
  return (req, _res, next) => {
    requestContext.run({ requestId: req.id }, next);
  };
}
