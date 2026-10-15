import { HEADERS } from '@payment-sim/shared';
import type { Request } from 'express';
import { ValidationError } from '../../core/errors';

/** Printable ASCII without spaces: UUIDs, ULIDs, "order-1001:attempt-2" and the like. */
const IDEMPOTENCY_KEY = /^[\x21-\x7E]{1,255}$/;

/** Returns the key, undefined if the header is absent, or throws if it is malformed. */
export function readIdempotencyKey(req: Request): string | undefined {
  const value = req.get(HEADERS.IDEMPOTENCY_KEY);
  if (value === undefined) return undefined;
  if (!IDEMPOTENCY_KEY.test(value)) {
    throw headerError(
      HEADERS.IDEMPOTENCY_KEY,
      'must be 1-255 printable ASCII characters without spaces',
    );
  }
  return value;
}

/** Payment versions travel as strong ETags: "3". */
export function versionETag(version: number): string {
  return `"${version}"`;
}

/**
 * Parse If-Match into the version the client last saw. Accepts the ETag we issue ("3") and,
 * leniently, its weak form (W/"3"). Lists and "*" are not meaningful for a single payment.
 */
export function readIfMatchVersion(req: Request): number | undefined {
  const value = req.get(HEADERS.IF_MATCH);
  if (value === undefined) return undefined;
  const match = /^(?:W\/)?"(\d{1,9})"$/.exec(value.trim());
  if (!match?.[1]) {
    throw headerError(HEADERS.IF_MATCH, 'must be a payment ETag such as "3"');
  }
  return Number(match[1]);
}

function headerError(header: string, message: string): ValidationError {
  return new ValidationError(
    [{ location: 'headers', field: header, messages: [`${header} ${message}`] }],
    `Invalid ${header} header`,
  );
}
