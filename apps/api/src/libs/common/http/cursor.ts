import { ValidationError } from '../../core/errors';

/** Position after the last row of a page, ordered by (created_at DESC, id DESC). */
export interface KeysetCursor {
  /** Microsecond-precision UTC timestamp as rendered by Postgres, e.g. 2026-10-15T13:04:11.702123Z. */
  createdAt: string;
  id: string;
}

const MICROSECOND_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Opaque to clients (base64url), so the encoding can change without breaking anyone. The
 * timestamp keeps Postgres's microseconds: a JS Date would truncate to milliseconds, and two
 * payments created in the same millisecond could then be skipped or repeated across pages.
 */
export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id])).toString('base64url');
}

export function decodeCursor(value: string): KeysetCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      MICROSECOND_ISO.test(parsed[0]) &&
      UUID.test(parsed[1])
    ) {
      return { createdAt: parsed[0], id: parsed[1] };
    }
  } catch {
    // fall through to the validation error
  }
  throw new ValidationError(
    [
      {
        location: 'query',
        field: 'cursor',
        messages: ['cursor is not a valid page cursor'],
      },
    ],
    'Invalid pagination cursor',
  );
}
