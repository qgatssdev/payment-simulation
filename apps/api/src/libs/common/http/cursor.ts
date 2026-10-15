import { ValidationError } from '../../core/errors';

/** Position after the last item of a page, ordered by (createdAt DESC, id DESC). */
export interface KeysetCursor {
  /** The item's createdAt as an ISO-8601 UTC string, e.g. 2026-10-15T13:04:11.702Z. */
  createdAt: string;
  id: string;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Opaque to clients (base64url), so the encoding can change without breaking anyone. The id
 * is part of the position because several payments can share a millisecond: with the
 * timestamp alone they could be skipped or repeated across pages.
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
      ISO_TIMESTAMP.test(parsed[0]) &&
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
