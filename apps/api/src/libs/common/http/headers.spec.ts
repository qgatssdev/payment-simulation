import type { Request } from 'express';
import { ValidationError } from '../../core/errors';
import { readIdempotencyKey, readIfMatchVersion, versionETag } from './headers';

const req = (headers: Record<string, string>) =>
  ({
    get: (name: string) =>
      Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1],
  }) as unknown as Request;

describe('readIdempotencyKey', () => {
  it.each(['550e8400-e29b-41d4-a716-446655440000', 'order-1001:attempt-2', 'k'])(
    'accepts %s',
    (key) => expect(readIdempotencyKey(req({ 'Idempotency-Key': key }))).toBe(key),
  );

  it('returns undefined when absent', () => {
    expect(readIdempotencyKey(req({}))).toBeUndefined();
  });

  it.each(['', 'has space', 'x'.repeat(256), 'tab\there', 'émoji'])(
    'rejects %p',
    (key) => {
      expect(() => readIdempotencyKey(req({ 'Idempotency-Key': key }))).toThrow(
        ValidationError,
      );
    },
  );
});

describe('If-Match versions', () => {
  it('round-trips the ETag we issue', () => {
    expect(versionETag(3)).toBe('"3"');
    expect(readIfMatchVersion(req({ 'If-Match': versionETag(3) }))).toBe(3);
  });

  it('accepts the weak form and surrounding whitespace', () => {
    expect(readIfMatchVersion(req({ 'If-Match': ' W/"12" ' }))).toBe(12);
  });

  it('returns undefined when absent', () => {
    expect(readIfMatchVersion(req({}))).toBeUndefined();
  });

  it.each(['3', '*', '"a"', '"1", "2"', '"1234567890"'])('rejects %p', (value) => {
    expect(() => readIfMatchVersion(req({ 'If-Match': value }))).toThrow(ValidationError);
  });
});
