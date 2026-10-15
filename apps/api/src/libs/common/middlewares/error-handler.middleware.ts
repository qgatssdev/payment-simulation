import type { ApiErrorBody } from '@payment-sim/shared';
import { ErrorCode } from '@payment-sim/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import {
  AppError,
  NotFoundError,
  PayloadTooLargeError,
  ServiceUnavailableError,
  ValidationError,
  mapDatabaseError,
} from '../../core/errors';
import type { Logger } from '../../core/logger/logger';

interface BodyParserError {
  type: string;
  status: number;
  limit?: number;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { type?: unknown }).type === 'string' &&
    typeof (error as { status?: unknown }).status === 'number'
  );
}

/** Classify anything thrown into the error we will answer with. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (isBodyParserError(error)) {
    if (error.type === 'entity.too.large') {
      return new PayloadTooLargeError(`${error.limit ?? 'configured'} byte`);
    }
    const message =
      error.type === 'entity.parse.failed'
        ? 'Malformed JSON body'
        : 'Unreadable request body';
    return new ValidationError(
      [{ location: 'body', field: '', messages: [message] }],
      message,
    );
  }

  return (
    mapDatabaseError(error) ??
    new AppError(
      ErrorCode.INTERNAL_ERROR,
      500,
      'An unexpected error occurred',
      undefined,
      {
        cause: error,
      },
    )
  );
}

/**
 * The single place errors become responses. Replaces the nest-template's per-method
 * try/catch + handleErrorCatch: services throw, Express 5 forwards rejected promises here.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      // Too late to send an error body; let Express tear the connection down.
      next(error);
      return;
    }

    const appError = toAppError(error);
    if (appError.status >= 500) {
      // Log what actually happened; the client only gets the sanitised message.
      logger.error({ err: error, code: appError.code }, 'request failed');
    }
    if (appError instanceof ServiceUnavailableError) {
      res.setHeader('Retry-After', String(appError.retryAfterSeconds));
    }

    const body: ApiErrorBody = {
      success: false,
      message: appError.message,
      error: {
        code: appError.code,
        ...(appError.details === undefined ? {} : { details: appError.details }),
      },
      requestId: req.id,
    };
    res.status(appError.status).json(body);
  };
}

export function notFoundHandler(): RequestHandler {
  return (req, _res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
  };
}
