import type { ApiErrorBody, ValidationIssue } from '@payment-sim/shared';
import { ErrorCode } from '@payment-sim/shared';

export type ErrorDetails = ApiErrorBody['error']['details'];

/**
 * Base for every error the API deliberately returns. Services throw these; the single error
 * middleware turns them into responses. Anything that is not an AppError is a bug or an
 * infrastructure failure and is reported as a generic 500 (or 503, see mapDatabaseError).
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: ErrorDetails,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(issues: ValidationIssue[], message = 'Request validation failed') {
    super(ErrorCode.VALIDATION_ERROR, 400, message, issues);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(limit: string) {
    super(ErrorCode.PAYLOAD_TOO_LARGE, 413, `Request body exceeds the ${limit} limit`);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(ErrorCode.NOT_FOUND, 404, message);
  }

  static resource(resource: string, id: string): NotFoundError {
    return new NotFoundError(`${resource} ${id} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.CONFLICT,
    details?: ErrorDetails,
    options?: ErrorOptions,
  ) {
    super(code, 409, message, details, options);
  }
}

export class PreconditionFailedError extends AppError {
  constructor(message: string, details?: ErrorDetails) {
    super(ErrorCode.PRECONDITION_FAILED, 412, message, details);
  }
}

export class RateLimitError extends AppError {
  constructor() {
    super(ErrorCode.RATE_LIMITED, 429, 'Too many requests, please slow down');
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(
    message = 'Service temporarily unavailable, please retry',
    readonly retryAfterSeconds = 1,
    options?: ErrorOptions,
  ) {
    super(ErrorCode.SERVICE_UNAVAILABLE, 503, message, undefined, options);
  }
}
