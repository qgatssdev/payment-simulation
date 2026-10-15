import { ValidationError } from '../../core/errors';
import { decodeCursor, encodeCursor } from './cursor';

const cursor = {
  createdAt: '2026-10-15T13:04:11.702Z',
  id: '6f1c2a8e-3b7d-4c1e-9f0a-2b3c4d5e6f70',
};

describe('keyset cursor', () => {
  it('round-trips and is URL-safe', () => {
    const encoded = encodeCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it.each([
    ['not base64 JSON', 'garbage!!'],
    ['wrong shape', Buffer.from('{"a":1}').toString('base64url')],
    [
      'a non-ISO timestamp',
      encodeCursor({ ...cursor, createdAt: '2026-10-15 13:04:11' }),
    ],
    ['non-uuid id', encodeCursor({ ...cursor, id: '1; DROP TABLE payments' })],
    ['empty', ''],
  ])('rejects %s with a query validation error', (_label, value) => {
    let error: unknown;
    try {
      decodeCursor(value);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).details).toEqual([
      {
        location: 'query',
        field: 'cursor',
        messages: ['cursor is not a valid page cursor'],
      },
    ]);
  });
});
